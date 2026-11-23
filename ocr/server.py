import hashlib
import hmac
import http.client
import io
import json
import os
import re
import secrets
import subprocess
import threading
import time
from collections import OrderedDict
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from PIL import Image

MODULE_ID = "foto-aufgaben"
PREFIX = f"/api/extensions/{MODULE_ID}"
COOKIE_NAME = "__Host-foto-aufgaben-csrf"
MAX_UPLOAD = 5 * 1024 * 1024
MAX_EDGE = 2400
MAX_TEXT = 5000
OCR_TIMEOUT = 20
AUTH_TTL = 4
AUTH_CACHE_SIZE = 128
Image.MAX_IMAGE_PIXELS = MAX_EDGE ** 2


class RequestError(Exception):
    def __init__(self, status, reason):
        self.status = status
        self.reason = reason


def configured_url(name, schemes, default=None):
    url = urlsplit(os.environ.get(name, default or ""))
    if (
        url.scheme not in schemes
        or not url.hostname
        or url.username is not None
        or url.password is not None
        or url.path not in ("", "/")
        or url.query
        or url.fragment
    ):
        raise SystemExit(f"Provide an origin without a path in {name}")
    return url


def recognize_photo(payload):
    try:
        with Image.open(io.BytesIO(payload), formats=["JPEG"]) as image:
            if max(image.size) > MAX_EDGE:
                raise RequestError(413, "image_too_large")
            monochrome = io.BytesIO()
            image.convert("L").save(monochrome, format="PNG")
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        raise RequestError(422, "invalid_image") from error

    try:
        result = subprocess.run(
            ["tesseract", "stdin", "stdout", "-l", "deu+eng", "--psm", "6"],
            input=monochrome.getvalue(),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=OCR_TIMEOUT,
            check=True,
        )
    except subprocess.TimeoutExpired as error:
        raise RequestError(504, "recognition_timeout") from error
    except (OSError, subprocess.CalledProcessError) as error:
        raise RequestError(503, "recognition_unavailable") from error

    text = result.stdout.decode("utf-8", errors="replace").strip()
    return {"text": text[:MAX_TEXT], "truncated": len(text) > MAX_TEXT}


class Yuvomi:
    def __init__(self, origin):
        self.origin = origin
        self.secret = secrets.token_bytes(32)
        self.cache = OrderedDict()
        self.lock = threading.Lock()

    def get(self, path, session):
        client = http.client.HTTPSConnection if self.origin.scheme == "https" else http.client.HTTPConnection
        connection = client(self.origin.hostname, self.origin.port, timeout=3)
        try:
            connection.request("GET", f"/api/v1{path}", headers={"Cookie": session, "Accept": "application/json"})
            response = connection.getresponse()
            if response.status == 401:
                raise RequestError(401, "sign_in_required")
            if response.status == 403:
                raise RequestError(403, "access_denied")
            if response.status == 429:
                raise RequestError(429, "busy")
            if response.status != 200:
                raise RequestError(503, "yuvomi_unavailable")
            return json.loads(response.read(1024 * 1024))
        except (OSError, http.client.HTTPException, ValueError) as error:
            raise RequestError(503, "yuvomi_unavailable") from error
        finally:
            connection.close()

    def authorize(self, session):
        key = hashlib.sha256(session.encode("ascii")).digest()
        with self.lock:
            cached = self.cache.get(key, 0)
            if cached > time.monotonic():
                self.cache.move_to_end(key)
                return

        me = self.get("/auth/me", session)
        module_access = me.get("permissions", {}).get("modules", {})
        if module_access.get(f"ext:{MODULE_ID}") != "write" or module_access.get("tasks") != "write":
            raise RequestError(403, "access_denied")

        modules = self.get("/modules", session)
        if not any(module.get("id") == MODULE_ID and module.get("enabled") for module in modules["data"]):
            raise RequestError(403, "module_disabled")

        with self.lock:
            self.cache[key] = time.monotonic() + AUTH_TTL
            self.cache.move_to_end(key)
            if len(self.cache) > AUTH_CACHE_SIZE:
                self.cache.popitem(last=False)

    def csrf_token(self, session):
        return hmac.digest(self.secret, session.encode("ascii"), "sha256").hex()


def session_cookie(cookies):
    for name in ("yuvomi.sid", "oikos.sid"):
        if name in cookies:
            value = cookies[name].value
            if re.fullmatch(r"[A-Za-z0-9%+=._~-]{1,512}", value):
                return f"{name}={value}"
            break
    raise RequestError(401, "sign_in_required")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        # No request details, sessions or recognized text in container logs.
        return

    def send_json(self, status, body, cookie=None):
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def dispatch(self, method):
        try:
            if method == "GET" and self.path == "/healthz":
                self.send_json(200, {"ok": True})
                return
            if (method, self.path) not in (
                ("GET", f"{PREFIX}/csrf"),
                ("POST", f"{PREFIX}/recognize"),
            ):
                raise RequestError(404, "not_found")
            cookies = SimpleCookie(self.headers.get("Cookie", ""))
            session = session_cookie(cookies)
            token = self.server.yuvomi.csrf_token(session)
            if method == "GET":
                self.server.yuvomi.authorize(session)
                cookie = f"{COOKIE_NAME}={token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600"
                self.send_json(200, {"token": token}, cookie)
                return

            cookie = cookies.get(COOKIE_NAME)
            supplied = self.headers.get("X-Photo-CSRF", "")
            if (
                self.headers.get("Origin") != self.server.public_origin
                or not cookie
                or not re.fullmatch(r"[a-f0-9]{64}", supplied)
                or not re.fullmatch(r"[a-f0-9]{64}", cookie.value)
                or not hmac.compare_digest(supplied, token)
                or not hmac.compare_digest(cookie.value, token)
            ):
                raise RequestError(403, "invalid_csrf")

            if self.headers.get("Content-Type") != "image/jpeg" or self.headers.get("Content-Encoding"):
                raise RequestError(415, "jpeg_required")
            length = self.headers.get("Content-Length", "")
            if self.headers.get("Transfer-Encoding") or not re.fullmatch(r"[0-9]{1,9}", length):
                raise RequestError(411, "length_required")
            length = int(length)
            if length == 0 or length > MAX_UPLOAD:
                raise RequestError(413, "invalid_size")

            self.server.yuvomi.authorize(session)
            if not self.server.ocr_slots.acquire(blocking=False):
                raise RequestError(429, "busy")
            try:
                payload = self.rfile.read(length)
                if len(payload) != length:
                    raise RequestError(400, "incomplete_image")
                output = recognize_photo(payload)
            finally:
                self.server.ocr_slots.release()
            self.send_json(200, output)
        except RequestError as error:
            self.send_json(error.status, {"error": error.reason})


class Server(ThreadingHTTPServer):
    # One slot for OCR, with additional short-lived connections for auth and health.
    clients = threading.BoundedSemaphore(12)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(10)
        return connection, address

    def process_request(self, request, client_address):
        if not self.clients.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.clients.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.clients.release()

    def handle_error(self, _request, _client_address):
        # TCP disconnects and timeouts end the request. Keep client data out of logs.
        return


def main():
    upstream = configured_url("YUVOMI_INTERNAL_URL", {"http", "https"}, "http://yuvomi:3000")
    public = configured_url("PUBLIC_ORIGIN", {"https"})
    server = Server(("0.0.0.0", 8787), Handler)
    server.yuvomi = Yuvomi(upstream)
    server.public_origin = f"{public.scheme}://{public.netloc}"
    server.ocr_slots = threading.BoundedSemaphore(1)
    server.serve_forever()


if __name__ == "__main__":
    main()
