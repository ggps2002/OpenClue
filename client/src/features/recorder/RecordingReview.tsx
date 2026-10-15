import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { formatBytes, formatDuration } from '../../lib/format';
import type { RecordingResult } from './ScreenRecorder';

interface RecordingReviewProps {
  result: RecordingResult;
  defaultName: string;
  saving: boolean;
  onSave(name: string): void;
  onDiscard(): void;
}

export function RecordingReview({ result, defaultName, saving, onSave, onDiscard }: RecordingReviewProps) {
  const [name, setName] = useState(defaultName);
  const [previewUrl, setPreviewUrl] = useState<string>();

  useEffect(() => {
    const url = URL.createObjectURL(result.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result.blob]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) onSave(name.trim());
  };

  const clicks = result.clicks.length;
  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
      {previewUrl && (
        <video src={previewUrl} controls className="aspect-video w-full rounded-lg bg-slate-900" aria-label="Recording preview" />
      )}
      <p className="text-sm text-slate-600">
        {formatDuration(result.durationMs)} · {result.width}×{result.height} · {formatBytes(result.blob.size)} ·{' '}
        {clicks} {clicks === 1 ? 'click' : 'clicks'} captured{result.hasAudio ? '' : ' · no audio'}
      </p>
      <div className="max-w-sm">
        <TextField label="Recording name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={150} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : 'Save recording'}
        </Button>
        <Button variant="secondary" onClick={onDiscard} disabled={saving}>
          Discard and record again
        </Button>
      </div>
    </form>
  );
}
