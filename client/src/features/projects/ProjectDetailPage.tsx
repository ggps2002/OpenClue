import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Button, buttonClasses } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { ApiError } from '../../lib/ApiClient';
import { useAsync } from '../../lib/useAsync';
import { MediaCard, MediaGrid } from '../media/MediaCard';
import { mediaApi, type MediaAsset } from '../media/media.api';
import { UploadButton } from '../media/UploadButton';
import { LibraryPicker } from './LibraryPicker';
import { ProjectTitle } from './ProjectTitle';
import { projectsApi, type ProjectDetail } from './projects.api';

export function ProjectDetailPage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const project = useAsync(useCallback(() => projectsApi.get(projectId), [projectId]));
  const [error, setError] = useState<string>();

  const update = (change: (p: ProjectDetail) => ProjectDetail) => project.setData((p) => p && change(p));
  const report = (err: unknown, fallback: string) => setError(err instanceof ApiError ? err.message : fallback);

  if (project.error) {
    const notFound = project.error instanceof ApiError && project.error.status === 404;
    return (
      <div className="mx-auto max-w-6xl px-8 py-10">
        <Alert>{notFound ? 'This project does not exist or you no longer have access.' : project.error.message}</Alert>
        <Link to="/app/projects" className="mt-4 inline-block text-sm font-medium text-indigo-600 hover:underline">
          Back to projects
        </Link>
      </div>
    );
  }
  if (!project.data) return <Spinner label="Loading project" />;

  const current = project.data;
  const canEdit = current.role !== 'viewer';

  const addMedia = (asset: MediaAsset) =>
    update((p) => ({ ...p, media: [asset, ...p.media.filter((m) => m.id !== asset.id)], mediaCount: p.mediaCount + 1 }));
  const dropMedia = (id: string) =>
    update((p) => ({ ...p, media: p.media.filter((m) => m.id !== id), mediaCount: p.mediaCount - 1 }));

  const handleRename = async (name: string) => {
    const renamed = await projectsApi.rename(current.id, name);
    update((p) => ({ ...p, name: renamed.name, updatedAt: renamed.updatedAt }));
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete “${current.name}”? Its files stay in the media library.`)) return;
    try {
      await projectsApi.remove(current.id);
      navigate('/app/projects', { replace: true });
    } catch (err) {
      report(err, 'Could not delete the project');
    }
  };

  const handleUnlink = async (asset: MediaAsset) => {
    try {
      await mediaApi.update(asset.id, { projectId: null });
      dropMedia(asset.id);
    } catch (err) {
      report(err, 'Could not remove the file from this project');
    }
  };

  const handleLink = async (mediaId: string) => {
    try {
      addMedia(await mediaApi.update(mediaId, { projectId: current.id }));
    } catch (err) {
      report(err, 'Could not add the file');
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <Link to="/app/projects" className="text-sm font-medium text-indigo-600 hover:underline">
        ← All projects
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <ProjectTitle name={current.name} canEdit={canEdit} onRename={handleRename} />
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/app/projects/${current.id}/script`} className={buttonClasses('primary')}>
            Script
          </Link>
          <Link to={`/app/projects/${current.id}/captions`} className={buttonClasses('secondary')}>
            Captions
          </Link>
          <Link to={`/app/projects/${current.id}/editor`} className={buttonClasses('primary')}>
            Edit video
          </Link>
          <Link to={`/app/projects/${current.id}/export`} className={buttonClasses('secondary')}>
            Export
          </Link>
          {canEdit && (
            <>
              <Link to={`/app/record?projectId=${current.id}`} className={buttonClasses('secondary')}>
                Record screen
              </Link>
              <UploadButton
                workspaceId={current.workspaceId}
                projectId={current.id}
                onUploaded={addMedia}
                onError={setError}
              />
              <Button variant="secondary" onClick={() => void handleDelete()}>
                Delete project
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <section aria-labelledby="project-files" className="mt-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="project-files" className="text-lg font-semibold text-slate-900">
            Files
          </h2>
          {canEdit && (
            <LibraryPicker workspaceId={current.workspaceId} excludeIds={current.media.map((m) => m.id)} onPick={handleLink} />
          )}
        </div>
        {current.media.length === 0 ? (
          <EmptyState title="No files in this project">
            Upload a screen recording, screenshots, a PDF or a slide deck, or add something from your media library.
          </EmptyState>
        ) : (
          <MediaGrid>
            {current.media.map((asset) => (
              <MediaCard key={asset.id} asset={asset}>
                {canEdit && (
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void handleUnlink(asset)}>
                    Remove from project
                  </Button>
                )}
              </MediaCard>
            ))}
          </MediaGrid>
        )}
      </section>
    </div>
  );
}
