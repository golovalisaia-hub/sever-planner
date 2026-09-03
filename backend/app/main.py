from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import Base, engine
from app.routers import router

settings = get_settings()
app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins, allow_credentials=True, allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Content-Type", "X-SEVER-User-Id"])
app.include_router(router)


@app.on_event("startup")
def create_development_tables() -> None:
    if settings.environment == "development":
        Base.metadata.create_all(bind=engine)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name}
