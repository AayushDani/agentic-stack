import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const token = 'test-only-token';
const runId = 'a'.repeat(32);
const request = (credential = token, id = runId) => new Request('http://localhost/api/agentic-setup-check', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Setup-Token': credential },
  body: JSON.stringify({ runId: id }),
});
beforeEach(() => {
  vi.stubEnv('SETUP_CHECK_TOKEN', token);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://database.example');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'public-test-key');
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'public-analytics-test-key');
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://analytics.example');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('setup verification endpoint', () => {
  it('rejects an unauthenticated request before contacting either service', async () => {
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    expect((await POST(request('wrong'))).status).toBe(401);
    expect(network).not.toHaveBeenCalled();
  });
  it('rejects malformed probe IDs before writing analytics', async () => {
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    expect((await POST(request(token, "'; DROP TABLE users"))).status).toBe(400);
    expect(network).not.toHaveBeenCalled();
  });
  it('does not emit a successful analytics probe when the database fails', async () => {
    const network = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }));
    vi.stubGlobal('fetch', network);
    const result = await POST(request());
    expect(result.status).toBe(502);
    expect(network).toHaveBeenCalledTimes(1);
  });
  it('reports database success and ingestion acceptance separately', async () => {
    const network = vi.fn().mockResolvedValueOnce(Response.json(true)).mockResolvedValueOnce(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', network);
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ database: true, analyticsAccepted: true });
    const sent = JSON.parse(network.mock.calls[1][1].body);
    expect(sent.properties.setup_run_id).toBe(runId);
    expect(JSON.stringify(sent)).not.toContain(token);
  });
});
