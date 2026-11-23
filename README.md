# Foto-Aufgaben für Yuvomi

Fotografiere einen Aufgabenzettel oder wähle ein vorhandenes Bild. Tesseract liest gedruckten deutschen und englischen Text. Du kannst den Text korrigieren und daraus eine Aufgabe mit vollständiger Beschreibung oder je eine Aufgabe pro Zeile erstellen. Titel, Beschreibung, Fälligkeit, Zuständigkeit und Sichtbarkeit lassen sich vor dem Speichern bearbeiten. Standardmäßig sehen Ersteller und zugewiesene Personen die Aufgabe.

Das Foto bleibt bis zum Klick auf **Text erkennen** im Browser. Der Browser verkleinert es und entfernt die ursprünglichen EXIF-Metadaten durch JPEG-Neukodierung. Der lokale OCR-Dienst verarbeitet das JPEG im Arbeitsspeicher. Yuvomi speichert die bestätigten Aufgabenfelder. Die Erkennungsqualität hängt von Schärfe, Beleuchtung und Schrift ab. Besonders bei Handschrift kann es helfen, den Text über iPhones **Live Text** zu kopieren und direkt in das Modul einzufügen. Das Eingabefeld funktioniert auch, wenn der OCR-Dienst gerade nicht erreichbar ist.

## 1. Modul installieren

Das Paket ist für Yuvomi **2.93.0** gebaut. Das originale Yuvomi-Image bleibt im Einsatz.

- **Direkt von GitHub:** Unter **Einstellungen → Module → Eigenes Modul hinzufügen** diese Adresse eingeben: `https://github.com/aquaneno/yuvomi-photo-tasks/tree/main/foto-aufgaben`. Anschließend **Foto-Aufgaben** unter **Aktive Module** einschalten. Für den OCR-Dienst das gesamte Repository herunterladen oder klonen und mit Abschnitt 2 fortfahren.
- **Per ZIP über die Oberfläche:** Als Admin unter **Einstellungen → Module → Eigenes Modul hinzufügen** das Installations-ZIP oder das GitHub-Quellarchiv auswählen. Anschließend unter **Aktive Module** das Modul **Foto-Aufgaben** einschalten. Voraussetzung sind ein schreibbarer, persistenter Modulordner und `MODULES_ALLOW_WEB_INSTALL=true` in Yuvomis Containerumgebung. Die ZIP enthält genau ein Modulmanifest. Der Installer übernimmt den Ordner `foto-aufgaben/`.
- **Per Docker-Mount:** Das Archiv entpacken oder das Repository klonen und den Ordner `foto-aufgaben/` in das Host-Verzeichnis kopieren, das in Yuvomi als `/app/modules` eingebunden ist. Bei Yuvomis Standard-Compose ist das `${MODULES_DIR:-./modules}`. Den Ordnernamen beibehalten.

Für Mitglieder unter **Einstellungen → Haushalt → Rollen und Berechtigungen** bei **Foto-Aufgaben** und **Aufgaben** jeweils Schreibrechte vergeben. Ein Konto mit Leserechten kann keine OCR-Aufträge starten oder Aufgaben anlegen.

## 2. OCR-Dienst starten

Das Installations-ZIP in ein eigenes Verzeichnis entpacken oder das Repository klonen. Yuvomi, der OCR-Dienst und der Reverse Proxy brauchen ein gemeinsames Docker-Netz. Trage den Namen dieses vorhandenen Netzes in eine `.env` neben der mitgelieferten `compose.yaml` ein. Beispiel:

```dotenv
PUBLIC_ORIGIN=https://yuvomi.example.de
YUVOMI_INTERNAL_URL=http://yuvomi:3000
YUVOMI_DOCKER_NETWORK=yuvomi_default
```

- `PUBLIC_ORIGIN` ist die genaue HTTPS-Adresse, unter der du Yuvomi am Handy öffnest, ohne Pfad. Ein abweichender HTTPS-Port gehört mit in die Adresse.
- `YUVOMI_INTERNAL_URL` zeigt auf Yuvomis Container und internen Port. Die Standard-Compose verwendet `yuvomi:3000`. Falls dein Container anders heißt, dessen DNS-Namen einsetzen.
- Falls Nginx Proxy Manager in einem anderen Stack läuft, das gemeinsame Netz dort als externes Netzwerk am Proxy-Service ergänzen. Die DNS-Namen `yuvomi` und `foto-aufgaben-ocr` müssen für die beteiligten Container auflösbar sein.

```sh
docker compose up -d --build
```

Der Dienst veröffentlicht keinen Host-Port. Der Bildtransfer läuft über dieselbe HTTPS-Adresse wie Yuvomi. Für die Installation werden das Debian-Basisimage und die OCR-Sprachpakete geladen. Beim Betrieb verarbeitet Tesseract die Fotos lokal.

## 3. OCR-Pfad im Nginx Proxy Manager eintragen

Im bestehenden Yuvomi Proxy Host unter **Advanced** ergänzen:

```nginx
location ^~ /api/extensions/foto-aufgaben/ {
    resolver 127.0.0.11 valid=30s ipv6=off;
    set $foto_aufgaben_service foto-aufgaben-ocr:8787;
    proxy_pass http://$foto_aufgaben_service$request_uri;
    proxy_http_version 1.1;
    proxy_request_buffering on;
    client_max_body_size 5m;
    proxy_read_timeout 40s;
}
```

Der Dienst braucht den unveränderten Anfragepfad, den Session-Cookie und beim Upload die `Origin`- und `X-Photo-CSRF`-Header. Für andere Reverse Proxys denselben Präfix an `foto-aufgaben-ocr:8787` weiterleiten. Der Pfad ist von Yuvomis Service-Worker-Cache ausgenommen. Der Dienst prüft Sitzung, Modulstatus und Rechte über Yuvomis API und schützt den Upload mit einem eigenen CSRF-Token.

## Kurztest am Handy

1. Über HTTPS anmelden und **Foto-Aufgaben** öffnen.
2. Mit **Foto aufnehmen** eine kurze gedruckte Liste fotografieren. Am Desktop öffnet **Bild auswählen** die Dateiauswahl.
3. **Text erkennen** wählen, den Text prüfen und **Eine Aufgabe pro Zeile** auswählen.
4. **Vorschläge erstellen** wählen, bei Bedarf Felder ändern und **Aufgaben speichern** wählen.
5. In **Aufgaben** die neuen Einträge überprüfen.

Wenn **Text erkennen** fehlschlägt, öffne nach der Anmeldung im selben Browser `/api/extensions/foto-aufgaben/csrf` auf deiner Yuvomi-Domain. Eine JSON-Antwort zeigt, dass der Proxy den Dienst erreicht. `401` weist auf eine fehlende Sitzung hin, `403` auf fehlende Rechte oder ein deaktiviertes Modul und `502` typischerweise auf Proxy, Netzwerk oder Container.
