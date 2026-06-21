'use client';

// DEV-ONLY diagnostic page. Drives the gateway document parser against a bundled
// sample factsheet and dumps the result so we can see what's breaking. Removed
// once the gateway path is confirmed.
import { useEffect, useState } from 'react';
import { useEmbedToken } from '@/hooks/use-embed-token';

export default function ParseTestPage() {
  const token = useEmbedToken();
  const [out, setOut] = useState<string>('idle');
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setOut('running…');
    try {
      const res = await fetch('/api/dev/parse-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      setOut(JSON.stringify(json, null, 2));
    } catch (e) {
      setOut('FETCH ERROR: ' + (e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  // Auto-run once the token arrives so the preview pilot only needs to read the screen.
  useEffect(() => {
    if (token) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div style={{ padding: 16, fontFamily: 'monospace', fontSize: 12 }}>
      <h1 style={{ fontSize: 16 }}>parse-test</h1>
      <p data-testid="token-state">token: {token ? 'present' : 'waiting'}</p>
      <button data-testid="run-btn" onClick={run} disabled={running || !token} style={{ padding: '8px 12px', minHeight: 44 }}>
        {running ? 'running…' : 'Run parse diagnostic'}
      </button>
      <pre data-testid="parse-output" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 12 }}>
        {out}
      </pre>
    </div>
  );
}
