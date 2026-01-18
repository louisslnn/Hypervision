from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.middleware import RequestIdMiddleware
from app.routers.coach import router as coach_router
from app.routers.deep_insights import router as deep_insights_router
from app.routers.games import router as games_router
from app.routers.health import router as health_router
from app.routers.insights import router as insights_router
from app.routers.jobs import router as jobs_router
from app.routers.privacy import router as privacy_router
from app.routers.sync import router as sync_router

settings = get_settings()
configure_logging()

app = FastAPI(title="Magnus AI API", version="0.1.0")

origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestIdMiddleware)

app.include_router(health_router, prefix="/api")
app.include_router(sync_router, prefix="/api")
app.include_router(games_router, prefix="/api")
app.include_router(coach_router, prefix="/api")
app.include_router(privacy_router, prefix="/api")
app.include_router(insights_router, prefix="/api")
app.include_router(deep_insights_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")
