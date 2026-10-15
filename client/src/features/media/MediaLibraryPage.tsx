import { useCallback, useState } from 'react';
import { useCurrentWorkspace } from '../../app/AuthProvider';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Spinner } from '../../components/ui/Spinner';
import { ApiError } from '../../lib/ApiClient';
import { cn } from '../../lib/cn';
import { useAsync } from '../../lib/useAsync';
import { projectsApi } from '../projects/projects.api';
import { MediaCard, MediaGrid } from './MediaCard';
import { MEDIA_KINDS, mediaApi, type MediaAsset, type MediaKind } from './media.api';
import { UploadButton } from './UploadButton';

const filterLabels: Record<MediaKind, string> = {
  video: 'Videos',
  image: 'Images',
  audio: 'Audio',
  pdf: 'PDFs',
  slides: 'Slides',
};

export function MediaLibraryPage() {
  const workspace = useCurrentWorkspace();
  const canEdit = workspace.role !== 'viewer';
  const [kind, setKind] = useState<MediaKind | undefined>();
  const [errors, setErrors] = useState<string[]>([]);

  const media = useAsync(useCallback(() => mediaApi.list(workspace.id, { kind }), [workspace.id, kind]));
  const projects = useAsync(useCallback(() => projectsApi.list(workspace.id), [workspace.id]));

  const report = (message: string) => setErrors((prev) => [...prev, message]);
  const replace = (updated: MediaAsset) =>
    media.setData((list) => list?.map((m) => (m.id === updated.id ? updated : m)));

  const handleUploaded = (asset: MediaAsset) => {
    if (!kind || asset.kind === kind) media.setData((list) => [asset, ...(list ?? [])]);
  };

  const handleMove = async (asset: MediaAsset, projectId: string) => {
    try {
      replace(await mediaApi.update(asset.id, { projectId: projectId || null }));
    } catch (err) {
      report(err instanceof ApiError ? err.message : 'Could not move the file');
    }
  };

  const handleDelete = async (asset: MediaAsset) => {
    if (!window.confirm(`Delete “${asset.name}”? This removes it from every project.`)) return;
    try {
      await mediaApi.remove(asset.id);
      media.setData((list) => list?.filter((m) => m.id !== asset.id));
    } catch (err) {
      report(err instanceof ApiError ? err.message : 'Could not delete the file');
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <PageHeader
        title="Media library"
        description="Every recording, image, document and deck uploaded to this workspace."
        actions={canEdit && <UploadButton workspaceId={workspace.id} onUploaded={handleUploaded} onError={report} />}
      />

      <div role="group" aria-label="Filter by type" className="mt-6 flex flex-wrap gap-2">
        {[undefined, ...MEDIA_KINDS].map((k) => (
          <button
            key={k ?? 'all'}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={cn(
              'rounded-full px-3 py-1 text-sm font-medium',
              kind === k ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50',
            )}
          >
            {k ? filterLabels[k] : 'All'}
          </button>
        ))}
      </div>

      {errors.length > 0 && (
        <div className="mt-4 space-y-2">
          {errors.map((message, i) => (
            <Alert key={i}>{message}</Alert>
          ))}
          <Button variant="ghost" onClick={() => setErrors([])}>
            Dismiss
          </Button>
        </div>
      )}

      <div className="mt-6">
        {media.error ? (
          <Alert>Could not load the media library. {media.error.message}</Alert>
        ) : !media.data ? (
          <Spinner label="Loading media" />
        ) : media.data.length === 0 ? (
          <EmptyState title={kind ? `No ${filterLabels[kind].toLowerCase()} yet` : 'Your library is empty'}>
            Upload screen recordings, screenshots, PDFs or slide decks to use them in any project.
          </EmptyState>
        ) : (
          <MediaGrid>
            {media.data.map((asset) => (
              <MediaCard key={asset.id} asset={asset}>
                {canEdit && (
                  <>
                    <label className="sr-only" htmlFor={`project-${asset.id}`}>
                      Project for {asset.name}
                    </label>
                    <select
                      id={`project-${asset.id}`}
                      value={asset.projectId ?? ''}
                      onChange={(e) => void handleMove(asset, e.target.value)}
                      className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
                    >
                      <option value="">No project</option>
                      {projects.data?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void handleDelete(asset)}>
                      Delete
                    </Button>
                  </>
                )}
              </MediaCard>
            ))}
          </MediaGrid>
        )}
      </div>
    </div>
  );
}
