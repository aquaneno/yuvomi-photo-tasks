FROM debian:trixie-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pil tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.py /app/server.py
ENV PYTHONDONTWRITEBYTECODE=1 OMP_THREAD_LIMIT=2
USER 65534:65534
EXPOSE 8787
CMD ["python3", "-u", "/app/server.py"]
