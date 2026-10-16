import type { RefObject } from 'react';
import { Button } from '../../components/ui/Button';
import { formatTimecode } from '../../lib/format';
import type { PlayerState } from './TimelinePlayer';

interface PreviewPlayerProps {
  videoRef: RefObject<HTMLVideoElement>;
  state: PlayerState;
  durationMs: number;
  onToggle(): void;
  onSeek(timeMs: number): void;
}

/** The live preview: a video element driven by the TimelinePlayer, with play/pause and a scrubber. */
export function PreviewPlayer({ videoRef, state, durationMs, onToggle, onSeek }: PreviewPlayerProps) {
  return (
    <div className="overflow-hidden rounded-2xl bg-slate-900">
      <div className="relative aspect-video">
        <video ref={videoRef} className="h-full w-full object-contain" playsInline preload="auto" aria-label="Preview" />
        {state.sceneId === null && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
            {durationMs === 0 ? 'Add a scene to see a preview' : 'End of video'}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 bg-slate-800 px-4 py-2">
        <Button
          variant="ghost"
          className="px-2 py-1 text-white hover:bg-slate-700"
          onClick={onToggle}
          disabled={durationMs === 0}
        >
          {state.playing ? 'Pause' : 'Play'}
        </Button>
        <input
          type="range"
          aria-label="Playhead"
          className="flex-1 accent-indigo-400"
          min={0}
          max={durationMs}
          step={100}
          value={Math.min(state.timeMs, durationMs)}
          onChange={(e) => onSeek(Number(e.target.value))}
          disabled={durationMs === 0}
        />
        <span className="w-28 text-right font-mono text-xs text-slate-300 tabular-nums">
          {formatTimecode(state.timeMs)} / {formatTimecode(durationMs)}
        </span>
      </div>
    </div>
  );
}
