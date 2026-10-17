import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { buttonClasses } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { ApiError } from '../../lib/ApiClient';
import { useAsync } from '../../lib/useAsync';
import { timelineApi } from '../editor/timeline.api';
import { Timeline } from '../editor/Timeline';
import { projectsApi } from '../projects/projects.api';
import { exportsApi, isActive, type ExportItem } from './exports.api';
import { ExportForm } from './ExportForm';
import { ExportRow } from './ExportRow';
import { useExports } from './useExports';

export function ExportPage() {
  const { projectId = '' } = useParams();
  const page = useAsync(
    useCallback(async () => {
      const [project, timeline] = await Promise.all([projectsApi.get(projectId), timelineApi.get(projectId)]);
      return { project, doc: timeline.timeline };
    }, [projectId]),
  );
  const exports = useExports(projectId);
  const [error, setError] = useState<string>();

  const backLink = (
    <Link to={`/app/projects/${projectId}`} className="text-sm font-medium text-indigo-600 hover:underline">
      ← Back to project
    </Link>
  );
  const failure = page.error ?? exports.error;
  if (failure) {
    const notFound = failure instanceof ApiError && failure.status === 404;
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <Alert>{notFound ? 'This project does not exist or you no longer have access.' : failure.message}</Alert>
        <div className="mt-4">{backLink}</div>
      </div>
    );
  }
  if (!page.data || !exports.data) return <Spinner label="Loading exports" />;

  const { project, doc } = page.data;
  const { usage, exports: items } = exports.data;
  const canEdit = project.role !== 'viewer';
  const durationMs = doc ? new Timeline(doc).durationMs : 0;

  const remove = async (item: ExportItem) => {
    if (!isActive(item) && !window.confirm('Delete this export? The minutes it used still count this month.')) return;
    setError(undefined);
    try {
      await exportsApi.remove(item.id);
      exports.drop(item.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the export');
    }
  };

  let form = null;
  if (!doc || doc.scenes.length === 0) {
    form = (
      <EmptyState
        title="Make the edit first"
        action={
          <Link to={`/app/projects/${project.id}/editor`} className={buttonClasses()}>
            Open the editor
          </Link>
        }
      >
        Exports render the project's edit: its scenes, transitions and audio tracks.
      </EmptyState>
    );
  } else if (canEdit) {
    form = <ExportForm projectId={project.id} durationMs={durationMs} onCreated={exports.add} />;
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      {backLink}
      <h1 className="mt-3 text-2xl font-semibold text-slate-900">Export · {project.name}</h1>
      <p className="mt-1 text-sm text-slate-600">
        Turn the edit into a video file to share or embed. You have exported{' '}
        <strong className="font-semibold text-slate-900">{usage.exportMinutes} min</strong> of video this month.
      </p>
      <div className="mt-8 space-y-8">
        {form}
        {error && <Alert>{error}</Alert>}
        <section aria-labelledby="exports-title">
          <h2 id="exports-title" className="text-lg font-semibold text-slate-900">
            Exports
          </h2>
          {items.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">Nothing exported yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {items.map((item) => (
                <ExportRow key={item.id} item={item} canEdit={canEdit} onRemove={(i) => void remove(i)} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
