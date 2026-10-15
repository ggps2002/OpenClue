import type { ReactNode } from 'react';
import { formatBytes, formatDuration } from '../../lib/format';
import type { MediaAsset, MediaKind } from './media.api';

const kindLabels: Record<MediaKind, string> = {
  video: 'Video',
  image: 'Image',
  audio: 'Audio',
  pdf: 'PDF',
  slides: 'Slides',
};

function Preview({ asset }: { asset: MediaAsset }) {
  if (asset.kind === 'image') {
    return <img src={asset.url} alt="" loading="lazy" className="h-full w-full object-cover" />;
  }
  if (asset.kind === 'video') {
    // #t=0.1 nudges browsers into painting the first frame as a poster.
    return <video src={`${asset.url}#t=0.1`} preload="metadata" muted className="h-full w-full object-cover" />;
  }
  return (
    <span className="text-2xl font-bold tracking-wide text-slate-400" aria-hidden="true">
      {kindLabels[asset.kind].toUpperCase()}
    </span>
  );
}

export function MediaCard({ asset, children }: { asset: MediaAsset; children?: ReactNode }) {
  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <a
        href={asset.url}
        target="_blank"
        rel="noreferrer"
        className="flex aspect-video items-center justify-center bg-slate-100"
        aria-label={`Open ${asset.name}`}
      >
        <Preview asset={asset} />
      </a>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900" title={asset.name}>
            {asset.name}
          </p>
          <p className="text-xs text-slate-500">
            {kindLabels[asset.kind]} · {formatBytes(asset.sizeBytes)}
          </p>
          {asset.recording && (
            <p className="mt-1 text-xs text-indigo-700">
              Recorded · {formatDuration(asset.recording.durationMs)} · {asset.recording.clickCount}{' '}
              {asset.recording.clickCount === 1 ? 'click' : 'clicks'}
            </p>
          )}
        </div>
        {children && <div className="mt-auto flex flex-wrap items-center gap-2">{children}</div>}
      </div>
    </li>
  );
}

export function MediaGrid({ children }: { children: ReactNode }) {
  return <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{children}</ul>;
}
