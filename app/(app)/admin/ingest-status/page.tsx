'use client';

import { useEffect, useState } from 'react';
import { useEmbedToken } from '@/hooks/use-embed-token';

export default function IngestStatusPage() {
  const token = useEmbedToken();
  const [text, setText] = useState('loading…');

  useEffect(() => {
    if (!token) return;
    fetch('/api/cron/status', { headers: { 'x-embed-token': token } })
      .then((r) => r.json())
      .then((data) => setText(JSON.stringify(data, null, 2)))
      .catch((e) => setText(String(e)));
  }, [token]);

  return (
    <pre data-testid="ingest-status" style={{ padding: 16, fontSize: 12, whiteSpace: 'pre-wrap' }}>
      {token ? text : 'waiting for embed token…'}
    </pre>
  );
}
