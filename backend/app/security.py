from uuid import UUID

from fastapi import Header, HTTPException, status

from app.config import get_settings

DEVELOPMENT_ENVIRONMENTS = {"development", "test", "local"}


def current_user_id(x_sever_user_id: UUID | None = Header(default=None)) -> UUID:
    """Temporary development identity boundary; replace with signed session/JWT in auth milestone."""
    settings = get_settings()
    if settings.environment not in DEVELOPMENT_ENVIRONMENTS:
        # Fail closed: this header is self-asserted, so honouring it outside development
        # would let any caller read and write any account by guessing a user id.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Verified authentication is not configured for this environment",
        )
    if x_sever_user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    return x_sever_user_id
