"""Temporary DEBUG-session timing middleware. Writes NDJSON to workspace log."""
from __future__ import annotations

import json
import time
from pathlib import Path

from django.conf import settings
from django.db import connection

# Workspace log used by the debug ingest session (also under .cursor/)
_ROOT = Path(settings.BASE_DIR).parent
_LOG_PATH = _ROOT / ".cursor" / "debug-3d910e.log"


class PerfDebugMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not request.path.startswith("/api/"):
            return self.get_response(request)

        start = time.perf_counter()
        queries_before = len(connection.queries) if settings.DEBUG else None
        response = self.get_response(request)
        elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
        query_count = None
        if settings.DEBUG and queries_before is not None:
            query_count = len(connection.queries) - queries_before

        payload = {
            "sessionId": "3d910e",
            "runId": "baseline",
            "hypothesisId": "B-D",
            "location": "perf_debug_middleware.py",
            "message": "api_request",
            "data": {
                "path": request.path,
                "method": request.method,
                "status": getattr(response, "status_code", None),
                "elapsed_ms": elapsed_ms,
                "query_count": query_count,
                "content_length": response.get("Content-Length"),
                "debug": bool(settings.DEBUG),
            },
            "timestamp": int(time.time() * 1000),
        }
        try:
            with _LOG_PATH.open("a", encoding="utf-8") as f:
                f.write(json.dumps(payload, separators=(",", ":")) + "\n")
        except OSError:
            pass
        return response
