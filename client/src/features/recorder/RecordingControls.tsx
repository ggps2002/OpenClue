import { Button } from '../../components/ui/Button';
import { formatDuration } from '../../lib/format';

interface RecordingControlsProps {
  paused: boolean;
  elapsedMs: number;
  clickCount: number;
  onPause(): void;
  onResume(): void;
  onStop(): void;
}

export function RecordingControls({ paused, elapsedMs, clickCount, onPause, onResume, onStop }: RecordingControlsProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex items-center gap-3" role="status" aria-live="polite">
        <span
          aria-hidden="true"
          className={paused ? 'h-3 w-3 rounded-full bg-amber-400' : 'h-3 w-3 animate-pulse rounded-full bg-red-500'}
        />
        <span className="font-mono text-2xl tabular-nums text-slate-900">{formatDuration(elapsedMs)}</span>
        <span className="text-sm text-slate-600">
          {paused ? 'Paused' : 'Recording'} · {clickCount} {clickCount === 1 ? 'click' : 'clicks'} captured
        </span>
      </div>
      <div className="flex gap-2">
        {paused ? (
          <Button variant="secondary" onClick={onResume}>
            Resume
          </Button>
        ) : (
          <Button variant="secondary" onClick={onPause}>
            Pause
          </Button>
        )}
        <Button onClick={onStop}>Stop recording</Button>
      </div>
    </div>
  );
}
