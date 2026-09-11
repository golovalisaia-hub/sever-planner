-- SEVER least-privilege grants.
-- RLS remains the row-level boundary; this removes table capabilities the browser never needs.

-- Anonymous SEVER is local-only. It must not touch planner or AI cloud tables.
revoke all privileges on table
  public.profiles,
  public.tasks,
  public.habits,
  public.habit_entries,
  public.note_folders,
  public.notes,
  public.focus_sessions,
  public.user_settings,
  public.ai_memories,
  public.ai_plans,
  public.ai_usage,
  public.push_subscriptions,
  public.push_deliveries
from anon;

-- Start authenticated from no table privileges, then grant only the Data API actions SEVER uses.
revoke all privileges on table
  public.profiles,
  public.tasks,
  public.habits,
  public.habit_entries,
  public.note_folders,
  public.notes,
  public.focus_sessions,
  public.user_settings,
  public.ai_memories,
  public.ai_plans,
  public.ai_usage,
  public.push_subscriptions,
  public.push_deliveries
from authenticated;

grant select on table public.profiles to authenticated;
grant select, insert, update, delete on table
  public.tasks,
  public.habits,
  public.habit_entries,
  public.note_folders,
  public.notes,
  public.focus_sessions,
  public.user_settings,
  public.ai_memories,
  public.ai_plans,
  public.push_subscriptions
to authenticated;
grant select on table public.ai_usage to authenticated;

-- push_deliveries stays service-role only. Service role/postgres grants are intentionally unchanged.
