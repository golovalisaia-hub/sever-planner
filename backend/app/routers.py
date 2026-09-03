from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import ActionPreview, ChatRequest, EventCreate, EventRead, TaskCreate, TaskRead, TaskUpdate
from app.security import current_user_id
from app.services import create_event, create_task, get_task, list_events, list_tasks, update_task

router = APIRouter(prefix="/api")
Owner = Depends(current_user_id)
Database = Depends(get_db)


@router.get("/tasks", response_model=list[TaskRead])
def get_tasks(owner_id: UUID = Owner, db: Session = Database):
    return list_tasks(db, owner_id)


@router.post("/tasks", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
def post_task(data: TaskCreate, owner_id: UUID = Owner, db: Session = Database):
    return create_task(db, owner_id, data)


@router.patch("/tasks/{task_id}", response_model=TaskRead)
def patch_task(task_id: UUID, data: TaskUpdate, owner_id: UUID = Owner, db: Session = Database):
    return update_task(db, owner_id, task_id, data)


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: UUID, owner_id: UUID = Owner, db: Session = Database):
    db.delete(get_task(db, owner_id, task_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/events", response_model=list[EventRead])
def get_events(starts_after: datetime | None = None, ends_before: datetime | None = None, owner_id: UUID = Owner, db: Session = Database):
    return list_events(db, owner_id, starts_after, ends_before)


@router.post("/events", response_model=EventRead, status_code=status.HTTP_201_CREATED)
def post_event(data: EventCreate, owner_id: UUID = Owner, db: Session = Database):
    return create_event(db, owner_id, data)


@router.post("/ai/chat", response_model=ActionPreview)
def ai_chat(data: ChatRequest, owner_id: UUID = Owner):
    # Deliberately returns a safe preview only. The agent layer will call typed tools, never SQL.
    return ActionPreview(intent="needs_clarification", requires_confirmation=False, message="AI foundation is ready; connect a provider in the next milestone.", payload={"message": data.message, "owner_id": str(owner_id)})
