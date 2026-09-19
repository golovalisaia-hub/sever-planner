import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { dispatchReminders } from '../_tavro/reminders.ts';
import { TelegramApi } from '../_tavro/telegram.ts';
import { safeEqual } from '../_shared/validation.ts';

// Cron-driven dispatcher. Invoked by pg_cron (migration 019) with a shared
// secret, so a public call cannot trigger a send.
Deno.serve(async (request: Request) => {
  const presented = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const expected = Deno.env.get('TAVRO_CRON_SECRET') || '';
  if (!expected || !safeEqual(presented, expected)) {
    return new Response(JSON.stringify({ error: 'CRON_DENIED' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const telegram = new TelegramApi(Deno.env.get('TAVRO_BOT_TOKEN') || '');
  const summary = await dispatchReminders({ db, telegram, env: (name: string) => Deno.env.get(name) });
  return new Response(JSON.stringify(summary), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
});
