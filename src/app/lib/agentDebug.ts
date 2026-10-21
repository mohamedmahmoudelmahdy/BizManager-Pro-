/** Opt-in agent/perf NDJSON logging. Off unless VITE_AGENT_DEBUG=1. */
export const AGENT_DEBUG_ENABLED = import.meta.env.VITE_AGENT_DEBUG === '1';

export function agentDebugLog(payload: Record<string, unknown>): void {
  if (!AGENT_DEBUG_ENABLED) return;
  fetch('http://127.0.0.1:7474/ingest/758be5bb-e915-4993-b702-08eae1300535', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': '3d910e',
    },
    body: JSON.stringify({ sessionId: '3d910e', timestamp: Date.now(), ...payload }),
  }).catch(() => {});
}
