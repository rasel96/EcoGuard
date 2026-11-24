FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=5000 \
    WEB_CONCURRENCY=1 \
    GUNICORN_THREADS=4

WORKDIR /app

# Create non-root user
RUN useradd --create-home --shell /bin/bash appuser

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY . .
RUN chown -R appuser:appuser /app

USER appuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.getenv(\"PORT\", \"5000\")}/api/v1/health', timeout=4)"

CMD ["gunicorn", "-c", "gunicorn.conf.py", "app:app"]
