from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Event, Task
from app.schemas import EventCreate, TaskCreate, TaskUpdate


def list_tasks(db: Session, owner_id: UUID) -> list[Task]:
    return list(db.scalars(select(Task).where(Task.owner_id == owner_id).order_by(Task.scheduled_for, Task.created_at)))


def get_task(db: Session, owner_id: UUID, task_id: UUID) -> Task:
    task = db.scalar(select(Task).where(Task.id == task_id, Task.owner_id == owner_id))
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


def create_task(db: Session, owner_id: UUID, data: TaskCreate) -> Task:
    task = Task(owner_id=owner_id, **data.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def update_task(db: Session, owner_id: UUID, task_id: UUID, data: TaskUpdate) -> Task:
    task = get_task(db, owner_id, task_id)
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(task, key, value)
    db.commit()
    db.refresh(task)
    return task


def create_event(db: Session, owner_id: UUID, data: EventCreate) -> Event:
    if data.starts_at.tzinfo is None or data.ends_at.tzinfo is None or data.ends_at <= data.starts_at:
        raise HTTPException(status_code=422, detail="Event must have an end after its timezone-aware start")
    conflict = db.scalar(select(Event).where(Event.owner_id == owner_id, Event.starts_at < data.ends_at, Event.ends_at > data.starts_at))
    if conflict:
        raise HTTPException(status_code=409, detail={"message": "Calendar conflict", "event_id": str(conflict.id)})
    event = Event(owner_id=owner_id, **data.model_dump())
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def list_events(db: Session, owner_id: UUID, starts_after: datetime | None = None, ends_before: datetime | None = None) -> list[Event]:
    query = select(Event).where(Event.owner_id == owner_id)
    if starts_after:
        query = query.where(Event.ends_at > starts_after)
    if ends_before:
        query = query.where(Event.starts_at < ends_before)
    return list(db.scalars(query.order_by(Event.starts_at)))
