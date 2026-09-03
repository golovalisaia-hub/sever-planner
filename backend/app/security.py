from uuid import UUID

from fastapi import Header, HTTPException, status


def current_user_id(x_sever_user_id: UUID | None = Header(default=None)) -> UUID:
    """Temporary development identity boundary; replace with signed session/JWT in auth milestone."""
    if x_sever_user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    return x_sever_user_id
