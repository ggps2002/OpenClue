import type { CSSProperties, ReactNode, RefObject } from 'react';
import { Button } from '../../components/ui/Button';
import { formatTimecode } from '../../lib/format';
import type { PlayerState, VideoSlot } from './TimelinePlayer';
import { transitionStyles } from './transitions';

interface PreviewPlayerProps {
  videoRefs: readonly [RefObject<HTMLVideoElement>, RefObject<HTMLVideoElement>];
  state: PlayerState;
  durationMs: number;
  onToggle(): void;
  onSeek(timeMs: number): void;
  /** Drawn over the video, inside the 16:9 frame. */
  children?: ReactNode;
}

/** Shows the slot with the current scene; during a transition both slots show, styled by the transition. */
function slotStyle(state: PlayerState, slot: VideoSlot): CSSProperties {
  const incoming = slot === state.slot;
  if (state.sceneId === null) return { opacity: 0 };
  if (!state.transition) return { opacity: incoming ? 1 : 0, zIndex: incoming ? 1 : 0 };
  const styles = transitionStyles(state.transition.type, state.transition.progress);
  return { ...(incoming ? styles.to : styles.from), zIndex: incoming ? 1 : 0 };
}

/** The live preview: two video elements driven by the TimelinePlayer (plus any overlays), with play/pause and a scrubber. */
export function PreviewPlayer({ videoRefs, state, durationMs, onToggle, onSeek, children }: PreviewPlayerProps) {
  return (
    <div className="self-start overflow-hidden rounded-2xl bg-slate-900">
      <div className="relative aspect-video overflow-hidden bg-black">
        {([0, 1] as const).map((slot) => (
          <video
            key={slot}
            ref={videoRefs[slot]}
            className="absolute inset-0 h-full w-full object-contain"
            style={slotStyle(state, slot)}
            playsInline
            preload="auto"
            aria-label={slot === state.slot ? 'Preview' : undefined}
            aria-hidden={slot !== state.slot}
          />
        ))}
        {state.sceneId === null && (
          <div className="absolute inset-0 z-[2] flex items-center justify-center text-sm text-slate-400">
            {durationMs === 0 ? 'Add a scene to see a preview' : 'End of video'}
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 z-[3]">{children}</div>
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
