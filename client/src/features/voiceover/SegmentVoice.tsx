import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/cn';
import type { VoiceoverSegment } from './voiceover.api';

interface SegmentVoiceProps {
  clip: VoiceoverSegment;
  label: string;
  canEdit: boolean;
  /** Regenerating is blocked while the script has unsaved edits or another voicing runs. */
  disabled: boolean;
  regenerating: boolean;
  onPlay(url: string): void;
  onRegenerate(): void;
}

const STATUS: Record<VoiceoverSegment['status'], { text: string; className: string }> = {
  ready: { text: 'Voiced', className: 'bg-emerald-50 text-emerald-800' },
  stale: { text: 'Voice out of date', className: 'bg-amber-50 text-amber-800' },
  missing: { text: 'Not voiced', className: 'bg-slate-100 text-slate-600' },
  empty: { text: 'Nothing to say', className: 'bg-slate-100 text-slate-500' },
};

/** Voiceover status and controls shown under one script segment. */
export function SegmentVoice({ clip, label, canEdit, disabled, regenerating, onPlay, onRegenerate }: SegmentVoiceProps) {
  const status = STATUS[clip.status];
  const url = clip.audioUrl;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 text-xs">
      <span className={cn('rounded-full px-2 py-0.5 font-medium', status.className)}>{status.text}</span>
      {clip.tempo !== null && clip.tempo > 1.01 && <span className="text-slate-500">sped up {clip.tempo.toFixed(2)}×</span>}
      {clip.overflowMs > 0 && (
        <span className="font-medium text-amber-700">
          runs {(clip.overflowMs / 1000).toFixed(1)} s past its slot, shorten the text
        </span>
      )}
      <span className="ml-auto flex gap-1">
        {url && (
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onPlay(url)} aria-label={`Play voice for ${label}`}>
            🔊 Voice
          </Button>
        )}
        {canEdit && clip.status !== 'empty' && (
          <Button
            variant="ghost"
            className="px-2 py-1 text-xs"
            onClick={onRegenerate}
            disabled={disabled}
            aria-label={`Regenerate voice for ${label}`}
          >
            {regenerating ? 'Voicing…' : 'Regenerate'}
          </Button>
        )}
      </span>
    </div>
  );
}
