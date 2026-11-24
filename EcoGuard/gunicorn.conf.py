"""Gunicorn production configuration for EcoGuard."""

import os
import gunicorn

# Prevent leaking Gunicorn/Python version strings in the Server HTTP header.
gunicorn.SERVER = "EcoGuard"
gunicorn.SERVER_SOFTWARE = "EcoGuard"

bind = f"{os.getenv('HOST', '0.0.0.0')}:{os.getenv('PORT', '5000')}"
workers = int(os.getenv("WEB_CONCURRENCY", "2"))
threads = int(os.getenv("GUNICORN_THREADS", "4"))
timeout = int(os.getenv("GUNICORN_TIMEOUT", "120"))
graceful_timeout = 30
keepalive = 5
accesslog = "-"
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info").lower()
