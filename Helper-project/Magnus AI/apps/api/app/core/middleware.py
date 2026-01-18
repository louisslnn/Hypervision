from __future__ import annotations

import time
from uuid import uuid4

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.logging import correlation_id_ctx, get_logger, request_id_ctx

logger = get_logger("app.request")


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        incoming_request_id = request.headers.get("X-Request-ID")
        request_id = incoming_request_id or str(uuid4())
        incoming_correlation_id = request.headers.get("X-Correlation-ID")
        correlation_id = incoming_correlation_id or request_id

        token_request = request_id_ctx.set(request_id)
        token_correlation = correlation_id_ctx.set(correlation_id)

        request.state.request_id = request_id
        request.state.correlation_id = correlation_id

        start = time.perf_counter()
        logger.info(
            "request.start",
            extra={
                "event": "request.start",
                "method": request.method,
                "path": request.url.path,
            },
        )

        try:
            response = await call_next(request)
            duration_ms = int((time.perf_counter() - start) * 1000)
            response.headers["X-Request-ID"] = request_id
            response.headers["X-Correlation-ID"] = correlation_id
            logger.info(
                "request.complete",
                extra={
                    "event": "request.complete",
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": response.status_code,
                    "duration_ms": duration_ms,
                },
            )
            return response
        except Exception:
            duration_ms = int((time.perf_counter() - start) * 1000)
            logger.exception(
                "request.error",
                extra={
                    "event": "request.error",
                    "method": request.method,
                    "path": request.url.path,
                    "duration_ms": duration_ms,
                },
            )
            raise
        finally:
            request_id_ctx.reset(token_request)
            correlation_id_ctx.reset(token_correlation)
