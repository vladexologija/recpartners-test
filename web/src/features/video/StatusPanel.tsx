import type { Analysis } from '../../api/types';
import { formatPercent } from '../../lib/format';
import type { Connection } from './useVideo';

interface StatusPanelProps {
  analysis: Analysis | null;
  connection: Connection;
}

/** Shows where the analysis stands, with the brief's names: queued, processing, done, failed. */
export function StatusPanel({ analysis, connection }: StatusPanelProps) {
  if (!analysis) {
    return <p role="status">{connection === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</p>;
  }
  const { label, detail } = describe(analysis);
  return (
    <div className={`status status-${analysis.state}`} role="status" aria-live="polite">
      <p>
        <strong>{label}</strong>
        {detail && `: ${detail}`}
        {analysis.attempts > 1 && <span className="muted"> · started {analysis.attempts}×</span>}
      </p>
      {analysis.state === 'processing' && <progress value={analysis.progress ?? 0} max={1} />}
      {analysis.state === 'failed' && analysis.error && <p className="error">{analysis.error}</p>}
      {connection === 'reconnecting' && <p className="muted">Connection lost, reconnecting…</p>}
    </div>
  );
}

function describe(analysis: Analysis): { label: string; detail?: string } {
  switch (analysis.state) {
    case 'awaiting_upload':
      // The page opens once the file is in storage; the storage notification follows a moment later.
      return { label: 'Uploaded', detail: 'waiting for storage to confirm…' };
    case 'queued':
      return { label: 'Queued', detail: 'waiting for a worker…' };
    case 'processing':
      return { label: 'Processing', detail: `looking for hot dogs… ${formatPercent(analysis.progress ?? 0)}` };
    case 'done':
      return { label: 'Done' };
    case 'failed':
      return { label: 'Failed' };
  }
}
