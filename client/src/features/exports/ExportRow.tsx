import { useState } from 'react';
import { Button, buttonClasses } from '../../components/ui/Button';
import { formatBytes, formatDuration, formatRelative } from '../../lib/format';
import { EXPORT_OPTIONS, isActive, type ExportItem } from './exports.api';

const qualityLabel = (item: ExportItem) => EXPORT_OPTIONS[item.format].find((o) => o.value === item.quality)?.label ?? item.quality;

function statusText(item: ExportItem): string {
  if (item.status === 'rendering') return `Rendering… ${Math.round(item.progress * 100)}%`;
  if (item.status === 'queued') return item.queuePosition && item.queuePosition > 1 ? `Waiting (${item.queuePosition - 1} ahead)` : 'Waiting to start';
  if (item.status === 'failed') return 'Failed';
  return `Ready${item.sizeBytes ? ` · ${formatBytes(item.sizeBytes)}` : ''}`;
}

/** One export: live progress while rendering, then a preview and download link. */
export function ExportRow({ item, canEdit, onRemove }: { item: ExportItem; canEdit: boolean; onRemove(item: ExportItem): void }) {
  const [previewing, setPreviewing] = useState(false);
  const title = `${item.format === 'gif' ? 'GIF' : 'MP4'} · ${qualityLabel(item)}`;
  return (
    <li className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">{title}</p>
          <p className="text-sm text-slate-600">
            {formatDuration(item.durationMs)} · {formatRelative(item.createdAt)} ·{' '}
            <span className={item.status === 'failed' ? 'text-red-700' : undefined}>{statusText(item)}</span>
          </p>
        </div>
        {item.status === 'done' && item.fileUrl && item.downloadUrl && (
          <>
            <Button variant="secondary" className="px-3 py-1.5" aria-expanded={previewing} onClick={() => setPreviewing((p) => !p)}>
              {previewing ? 'Hide preview' : 'Preview'}
            </Button>
            <a href={item.downloadUrl} download className={buttonClasses('primary', 'px-3 py-1.5')}>
              Download
            </a>
          </>
        )}
        {canEdit && (
          <Button variant="ghost" className="px-3 py-1.5" onClick={() => onRemove(item)}>
            {isActive(item) ? 'Cancel' : 'Delete'}
          </Button>
        )}
      </div>
      {isActive(item) && (
        <div
          role="progressbar"
          aria-label={`${title} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(item.progress * 100)}
          className="h-2 overflow-hidden rounded-full bg-slate-100"
        >
          <div className="h-full rounded-full bg-indigo-500 transition-[width]" style={{ width: `${Math.max(2, item.progress * 100)}%` }} />
        </div>
      )}
      {item.status === 'failed' && item.error && <p className="text-sm text-red-700">{item.error}</p>}
      {previewing && item.fileUrl && (
        <div className="overflow-hidden rounded-lg bg-black">
          {item.format === 'gif' ? (
            <img src={item.fileUrl} alt={`${title} preview`} className="mx-auto max-h-[60vh]" />
          ) : (
            <video src={item.fileUrl} controls className="mx-auto max-h-[60vh] w-full" aria-label={`${title} preview`} />
          )}
        </div>
      )}
    </li>
  );
}
