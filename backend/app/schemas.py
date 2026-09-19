from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    scheduled_for: date | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=600)
    category: str = Field(default="Личное", min_length=1, max_length=80)
    priority: bool = False


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    scheduled_for: date | None = None
    duration_minutes: int | None = Field(default=None, ge=1, le=600)
    category: str | None = Field(default=None, min_length=1, max_length=80)
    priority: bool | None = None
    completed: bool | None = None

    @field_validator("title", "category", "priority", "completed")
    @classmethod
    def reject_explicit_null(cls, value):
        # None here means the client sent an explicit null for a non-nullable column,
        # which reaches the database as a constraint violation instead of a 422.
        if value is None:
            raise ValueError("Field cannot be null")
        return value


class TaskRead(TaskCreate):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    completed: bool


class EventCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    starts_at: datetime
    ends_at: datetime
    timezone: str = Field(default="Europe/Moscow", min_length=1, max_length=64)
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("ends_at")
    @classmethod
    def end_requires_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("Datetime must include a timezone offset")
        return value


class EventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str
    starts_at: datetime
    ends_at: datetime
    timezone: str
    notes: str | None = None


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


class ActionPreview(BaseModel):
    intent: str
    requires_confirmation: bool
    message: str
    payload: dict
