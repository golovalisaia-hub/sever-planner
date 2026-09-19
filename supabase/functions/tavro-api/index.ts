import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { createApiHandler } from '../_tavro/api.ts';

// Mini App API. Every request proves its identity with a Telegram initData
// signature; the quick-capture route uses its own revocable scoped token.
const handler = createApiHandler({ createClient, env: (name: string) => Deno.env.get(name) });

Deno.serve(handler);
