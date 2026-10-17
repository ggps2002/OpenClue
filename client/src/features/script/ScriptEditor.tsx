import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ApiError } from '../../lib/ApiClient';
import { formatRelative } from '../../lib/format';
import type { MediaAsset } from '../media/media.api';
import { SegmentVoice } from '../voiceover/SegmentVoice';
import { useVoiceover } from '../voiceover/useVoiceover';
import { VoiceoverPanel } from '../voiceover/VoiceoverPanel';
import { scriptApi, type Script, type ScriptSegment } from './script.api';
import { SegmentRow } from './SegmentRow';
import {
  findIssues,
  gapAfter,
  insertAfter,
  mergeWithNext,
  MIN_SEGMENT_MS,
  removeSegment,
  segmentAt,
  splitSegment,
  updateSegment,
} from './segments';
import { TranscriptPanel } from './TranscriptPanel';

interface ScriptEditorProps {
  script: Script;
  source: MediaAsset | undefined;
  canEdit: boolean;
  onSaved(script: Script): void;
  onRegenerate(): void;
}

const newId = () => crypto.randomUUID();

/** Timed segment list with a synced player. Edits stay local until saved. */
export function ScriptEditor({ script, source, canEdit, onSaved, onRegenerate }: ScriptEditorProps) {
  const [segments, setSegments] = useState<ScriptSegment[]>(script.segments);
  const [currentMs, setCurrentMs] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const stopAtRef = useRef<number | null>(null);
  const voiceover = useVoiceover(script.projectId);
  const clips = new Map(voiceover.voiceover?.segments.map((c) => [c.segmentId, c]));

  const issues = useMemo(() => findIssues(segments), [segments]);
  const dirty = useMemo(() => JSON.stringify(segments) !== JSON.stringify(script.segments), [segments, script.segments]);
  const active = segmentAt(segments, currentMs);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const play = (segment: ScriptSegment) => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = segment.startMs / 1000;
    stopAtRef.current = segment.endMs;
    void el.play().catch(() => undefined);
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

  const handleSave = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const cleaned = segments.map((s) => ({ ...s, text: s.text.trim() }));
      onSaved(await scriptApi.save(script.projectId, cleaned));
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues[0]?.message ?? err.message) : 'Could not save the script');
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = () => {
    if (dirty && !window.confirm('Discard your unsaved edits and write a new draft?')) return;
    onRegenerate();
  };

  const renderVoice = (segmentId: string, index: number) => {
    const clip = clips.get(segmentId);
    if (!clip) return null;
    const { busy } = voiceover;
    return (
      <SegmentVoice
        clip={clip}
        label={`segment ${index + 1}`}
        canEdit={canEdit}
        disabled={dirty || busy !== null}
        regenerating={busy?.kind === 'segment' && busy.segmentId === segmentId}
        onPlay={voiceover.playClip}
        onRegenerate={() => void voiceover.regenerateSegment(segmentId)}
      />
    );
  };

  const MediaTag = source?.kind === 'audio' ? 'audio' : 'video';

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        {source ? (
          <MediaTag
            ref={mediaRef}
            src={source.url}
            controls
            preload="metadata"
            onTimeUpdate={handleTimeUpdate}
            onSeeking={() => (stopAtRef.current = null)}
            className="w-full rounded-xl bg-slate-900"
            aria-label={`Preview of ${source.name}`}
          />
        ) : (
          <p className="rounded-xl bg-slate-100 p-6 text-sm text-slate-600">The recording this script was written from is no longer in the project.</p>
        )}
        {active && <p className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900">{active.text || '…'}</p>}
        <VoiceoverPanel state={voiceover} mediaRef={mediaRef} canEdit={canEdit} dirty={dirty} />
        {source && <TranscriptPanel mediaId={source.id} />}
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm text-slate-600">
            {segments.length} {segments.length === 1 ? 'segment' : 'segments'} · updated {formatRelative(script.updatedAt)}
          </p>
          {canEdit && (
            <>
              <Button variant="secondary" onClick={handleRegenerate} disabled={saving}>
                New draft
              </Button>
              <Button onClick={() => void handleSave()} disabled={!dirty || saving || issues.size > 0}>
                {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
              </Button>
            </>
          )}
        </div>
        {script.source === 'offline' && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            This draft was written in offline mode because no AI keys are configured, so the transcript is placeholder
            text. Edit it freely, or add API keys on the server and write a new draft.
          </p>
        )}
        {error && <Alert>{error}</Alert>}

        {segments.length === 0 && canEdit && (
          <Button variant="secondary" onClick={() => setSegments((list) => insertAfter(list, null, newId()))}>
            Add a segment
          </Button>
        )}
        <ol className="space-y-3">
          {segments.map((segment, i) => (
            <SegmentRow
              key={segment.id}
              segment={segment}
              index={i}
              issue={issues.get(segment.id)}
              active={active?.id === segment.id}
              canEdit={canEdit}
              canMerge={i < segments.length - 1}
              canInsertAfter={gapAfter(segments, i) >= MIN_SEGMENT_MS}
              onChange={(patch) => setSegments((list) => updateSegment(list, segment.id, patch))}
              onPlay={() => play(segment)}
              onSplit={() => setSegments((list) => splitSegment(list, segment.id, newId()))}
              onMerge={() => setSegments((list) => mergeWithNext(list, segment.id))}
              onRemove={() => setSegments((list) => removeSegment(list, segment.id))}
              onInsertAfter={() => setSegments((list) => insertAfter(list, segment.id, newId()))}
              footer={renderVoice(segment.id, i)}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}
