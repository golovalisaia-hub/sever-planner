// PHASE 3A · Option A probe: Supabase Data API (PostgREST) with service_role.
// Requires `izi` to be listed in Exposed Schemas. Read-only except nothing:
// it only calls izi.assert_environment and checks that the public key is refused.
//
//   IZI_SUPABASE_URL=https://<ref>.supabase.co \
//   IZI_SERVICE_ROLE_KEY=... IZI_PUBLIC_KEY=... node scripts/phase3a/data-api-probe.mjs
//
// Keys come only from the environment and are never printed.

const base = process.env.IZI_SUPABASE_URL;
const service = process.env.IZI_SERVICE_ROLE_KEY;
const publicKey = process.env.IZI_PUBLIC_KEY;
if (!base || !service || !publicKey) throw new Error('Set IZI_SUPABASE_URL, IZI_SERVICE_ROLE_KEY and IZI_PUBLIC_KEY');

const call = async (key, path, body) => {
  const started = performance.now();
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Accept-Profile': 'izi', 'Content-Profile': 'izi' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, ms: Math.round(performance.now() - started), marker: response.ok ? text : undefined };
};

const samples = [];
for (let i = 0; i < 10; i++) samples.push(await call(service, 'rpc/assert_environment', { p_expected: 'staging' }));
const anonRpc = await call(publicKey, 'rpc/assert_environment', { p_expected: 'staging' });
const anonTable = await call(publicKey, 'tasks?select=id&limit=1');
const sorted = samples.map(s => s.ms).sort((a, b) => a - b);

console.log(JSON.stringify({
  service_role: { statuses: [...new Set(samples.map(s => s.status))], marker: samples[0].marker, latency_ms: { p50: sorted[4], p90: sorted[8], max: sorted[9] } },
  public_key_refused: { rpc: anonRpc.status, table: anonTable.status, ok: anonRpc.status >= 400 && anonTable.status >= 400 },
}, null, 2));
