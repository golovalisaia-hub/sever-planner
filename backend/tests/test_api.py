from uuid import uuid4

from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app

Base.metadata.create_all(bind=engine)
client = TestClient(app)
USER_A = str(uuid4())
USER_B = str(uuid4())


def headers(user=USER_A):
    return {"X-SEVER-User-Id": user}


def test_task_requires_identity():
    assert client.get("/api/tasks").status_code == 401


def test_task_is_owned_by_its_creator():
    response = client.post("/api/tasks", headers=headers(), json={"title": "Подготовить демо", "duration_minutes": 30})
    assert response.status_code == 201
    task_id = response.json()["id"]
    assert client.patch(f"/api/tasks/{task_id}", headers=headers(USER_B), json={"completed": True}).status_code == 404
    assert client.get("/api/tasks", headers=headers(USER_B)).json() == []


def test_calendar_rejects_conflicts_and_naive_datetimes():
    payload = {"title": "Встреча", "starts_at": "2026-09-03T10:00:00+03:00", "ends_at": "2026-09-03T11:00:00+03:00", "timezone": "Europe/Moscow"}
    assert client.post("/api/events", headers=headers(), json=payload).status_code == 201
    conflict = client.post("/api/events", headers=headers(), json={**payload, "title": "Другая встреча", "starts_at": "2026-09-03T10:30:00+03:00", "ends_at": "2026-09-03T11:30:00+03:00"})
    assert conflict.status_code == 409
    naive = client.post("/api/events", headers=headers(), json={**payload, "starts_at": "2026-09-04T10:00:00", "ends_at": "2026-09-04T11:00:00"})
    assert naive.status_code == 422
