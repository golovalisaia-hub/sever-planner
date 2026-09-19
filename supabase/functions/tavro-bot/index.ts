import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { createBotHandler } from '../_tavro/bot.ts';

// Telegram webhook. Secrets stay in the function environment; the bot token is
// never sent to a client, a shortcut or a log line.
const handler = createBotHandler({ createClient, env: (name: string) => Deno.env.get(name) });

Deno.serve(handler);
