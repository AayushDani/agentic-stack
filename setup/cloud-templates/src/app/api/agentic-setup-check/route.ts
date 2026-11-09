import { timingSafeEqual } from 'node:crypto';

export async function POST(request: Request) {
  const expected = process.env.SETUP_CHECK_TOKEN;
  const provided = request.headers.get('x-setup-token') || '';
  if (!expected || Buffer.byteLength(provided) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let runId: unknown;
  try { ({ runId } = await request.json()); } catch { /* validated below */ }
  if (typeof runId !== 'string' || !/^[a-f0-9]{32}$/.test(runId)) {
    return Response.json({ error: 'Invalid run' }, { status: 400 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const analyticsKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const analyticsHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!url || !key || !analyticsKey || !analyticsHost) return Response.json({ error: 'Unconfigured' }, { status: 503 });
  try {
    const database = await fetch(`${url}/rest/v1/rpc/agentic_setup_ping`, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
      body: '{}', cache: 'no-store', signal: AbortSignal.timeout(10_000), redirect: 'error',
    });
    if (!database.ok || (await database.json()) !== true) return Response.json({ database: false }, { status: 502 });
    const analytics = await fetch(`${analyticsHost}/capture/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ api_key: analyticsKey, event: 'agentic_setup_verified',
        properties: { distinct_id: `setup-${runId}`, setup_run_id: runId, $process_person_profile: false },
        timestamp: new Date().toISOString() }),
      signal: AbortSignal.timeout(10_000), redirect: 'error',
    });
    return Response.json({ database: true, analyticsAccepted: analytics.ok }, { status: analytics.ok ? 200 : 502 });
  } catch {
    return Response.json({ error: 'Cloud service unavailable' }, { status: 502 });
  }
}
