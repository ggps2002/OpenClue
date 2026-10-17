import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ApiError } from '../../lib/ApiClient';
import { formatRelative } from '../../lib/format';
import type { MediaAsset } from '../media/media.api';
import { mergeWithNext, removeSegment, segmentAt, splitSegment, updateSegment } from '../script/segments';
import { syncTrack } from '../voiceover/syncTrack';
import { CaptionExport } from './CaptionExport';
import { CaptionLayer } from './CaptionLayer';
import { captionsApi, type CaptionCue, type CaptionPreset, type Captions, type CaptionStyle } from './captions.api';
import { CaptionStylePanel } from './CaptionStylePanel';
import { CueRow } from './CueRow';
import { findCueIssues } from './cues';

interface CaptionsEditorProps {
  captions: Captions;
  presets: CaptionPreset[];
  source: MediaAsset | undefined;
  voiceoverUrl: string | null;
  canEdit: boolean;
  onSaved(captions: Captions): void;
  onRebuild(): void;
}

const newId = () => crypto.randomUUID();

/** Caption cues and style with a live preview over the recording. Edits stay local until saved. */
export function CaptionsEditor({ captions, presets, source, voiceoverUrl, canEdit, onSaved, onRebuild }: CaptionsEditorProps) {
  const [cues, setCues] = useState<CaptionCue[]>(captions.cues);
  const [style, setStyle] = useState<CaptionStyle>(captions.style);
  const [currentMs, setCurrentMs] = useState(0);
  const [withVoiceover, setWithVoiceover] = useState(Boolean(voiceoverUrl));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const trackRef = useRef<HTMLAudioElement>(null);
  const stopAtRef = useRef<number | null>(null);

  const issues = useMemo(() => findCueIssues(cues), [cues]);
  const dirty = useMemo(
    () => JSON.stringify(cues) !== JSON.stringify(captions.cues) || JSON.stringify(style) !== JSON.stringify(captions.style),
    [cues, style, captions],
  );
  const active = segmentAt(cues, currentMs);

  useEffect(() => {
    const media = mediaRef.current;
    const track = trackRef.current;
    if (!withVoiceover || !media || !track) return;
    return syncTrack(media, track);
  }, [withVoiceover, voiceoverUrl]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const play = (cue: CaptionCue) => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = cue.startMs / 1000;
    stopAtRef.current = cue.endMs;
    void el.play()?.catch(() => undefined);
  };

  const handleTimeUpdate = () => {
    const el = mediaRef.current;
    if (!el) return;
    const ms = el.currentTime * 1000;
    setCurrentMs(ms);
    if (stopAtRef.current !== null && ms >= stopAtRef.current) {
      el.pause();
      stopAtRef.current = null;
    }
  };

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      onSaved(await captionsApi.save(captions.projectId, { cues: cues.map((c) => ({ ...c, text: c.text.trim() })), style }));
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues[0]?.message ?? err.message) : 'Could not save the captions');
    } finally {
      setSaving(false);
    }
  };

  const rebuild = () => {
    if (dirty && !window.confirm('Discard your unsaved caption edits?')) return;
    onRebuild();
  };

  const isAudio = source?.kind === 'audio';
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-900">
          {source && !isAudio && (
            <video
              ref={mediaRef}
              src={source.url}
              controls
              preload="metadata"
              onTimeUpdate={handleTimeUpdate}
              onSeeking={() => (stopAtRef.current = null)}
              className="absolute inset-0 h-full w-full object-contain"
              aria-label={`Preview of ${source.name}`}
            />
          )}
          {!source && <p className="absolute inset-x-0 top-4 text-center text-sm text-slate-400">The recording is no longer in this project.</p>}
          <CaptionLayer cues={cues} style={style} timeMs={currentMs} />
        </div>
        {source && isAudio && (
          <audio ref={mediaRef} src={source.url} controls preload="metadata" onTimeUpdate={handleTimeUpdate} className="w-full" aria-label={`Preview of ${source.name}`} />
        )}
        {voiceoverUrl && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={withVoiceover} onChange={(e) => setWithVoiceover(e.target.checked)} />
            Play with the voiceover
            <audio ref={trackRef} src={voiceoverUrl} preload="auto" className="hidden" />
          </label>
        )}
        <CaptionStylePanel style={style} presets={presets} disabled={!canEdit} onChange={setStyle} />
        <CaptionExport projectId={captions.projectId} disabled={dirty} />
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm text-slate-600">
            {cues.length} {cues.length === 1 ? 'caption' : 'captions'} · timed to the {captions.timing === 'voiceover' ? 'voiceover' : 'script'} · updated{' '}
            {formatRelative(captions.updatedAt)}
          </p>
          {canEdit && (
            <>
              <Button variant="secondary" onClick={rebuild} disabled={saving}>
                Rebuild
              </Button>
              <Button onClick={() => void save()} disabled={!dirty || saving || issues.size > 0}>
                {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
              </Button>
            </>
          )}
        </div>
        {captions.stale && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            The script or voiceover changed after these captions were made.{canEdit && ' Rebuild them to catch up (this replaces your caption edits).'}
          </p>
        )}
        {error && <Alert>{error}</Alert>}
        <ol className="space-y-2">
          {cues.map((cue, i) => (
            <CueRow
              key={cue.id}
              cue={cue}
              index={i}
              issue={issues.get(cue.id)}
              active={active?.id === cue.id}
              canEdit={canEdit}
              canMerge={i < cues.length - 1}
              onChange={(patch) => setCues((list) => updateSegment(list, cue.id, patch))}
              onPlay={() => play(cue)}
              onSplit={() => setCues((list) => splitSegment(list, cue.id, newId()))}
              onMerge={() => setCues((list) => mergeWithNext(list, cue.id))}
              onRemove={() => setCues((list) => removeSegment(list, cue.id))}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}
