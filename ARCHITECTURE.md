# SEVER — architecture foundation

## Current state

The existing application is a valuable offline-first PWA. Tasks, habits, notes, encrypted notes and the timer remain local and keep working on GitHub Pages. Its local browser storage is intentionally not treated as a multi-device production database.

## Target MVP

```
PWA / future web client
        │ HTTPS + typed API
FastAPI (Python) ── service layer ── PostgreSQL
        │
AI agent → validated tool registry → authorization → services
```

The AI layer receives no database connection and no raw SQL capability. Tools will always receive the authenticated user identity, validate their schema and call application services. Changes with material impact return a preview and require confirmation.

## Directory layout

```
backend/app/       API, schemas, services, security and data models
backend/tests/     authorization, validation and conflict checks
index.html         existing installable offline PWA
```

## Initial database entities

`users`, `profiles`, `calendars`, `events`, `tasks`, `goals`, `financial_goals`, `habits`, `notes`, `conversations`, `messages`, `ai_actions`, and `audit_logs` will be added through Alembic migrations. This first commit introduces calendar/task tables only, to keep the migration safe and verifiable.

## Roadmap

1. Foundation: API, owner boundaries, calendar conflict rules, typed contracts — this change.
2. Authentication, PostgreSQL, Alembic and migration from local PWA data.
3. Replace the PWA's task/calendar persistence with API sync and add day/week/agenda views.
4. Add agent tools, confirmation previews, audit/undo and an AI provider abstraction.
5. Add goals and safe financial goal planning.

## Key risks

- GitHub Pages cannot run Python or PostgreSQL; the API needs a separate secure host.
- User data must move to server-side identity before cross-device sync or AI actions.
- Recurrence, DST and external calendar sync require a dedicated calendar domain model, not date strings.
- An LLM must never receive database credentials or be allowed to issue SQL.
