from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class OwnedModel:
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    owner_id: Mapped[UUID] = mapped_column(index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Task(OwnedModel, Base):
    __tablename__ = "tasks"
    title: Mapped[str] = mapped_column(String(160))
    scheduled_for: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    category: Mapped[str] = mapped_column(String(80), default="Личное")
    priority: Mapped[bool] = mapped_column(Boolean, default=False)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)


class Event(OwnedModel, Base):
    __tablename__ = "events"
    calendar_id: Mapped[UUID | None] = mapped_column(ForeignKey("calendars.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(160))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/Moscow")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class Calendar(OwnedModel, Base):
    __tablename__ = "calendars"
    name: Mapped[str] = mapped_column(String(100))
    color: Mapped[str] = mapped_column(String(16), default="#7768e8")
