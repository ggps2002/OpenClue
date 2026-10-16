import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Button, buttonClasses } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { ApiError } from '../../lib/ApiClient';
import { formatDuration } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { projectsApi } from '../projects/projects.api';
import { EditorWorkspace } from './EditorWorkspace';
import { timelineApi, type TimelineData } from './timeline.api';

export function EditorPage() {
  const { projectId = '' } = useParams();
  const page = useAsync(
    useCallback(async () => {
      const [project, data] = await Promise.all([projectsApi.get(projectId), timelineApi.get(projectId)]);
      return { project, data };
    }, [projectId]),
  );
  const [creating, setCreating] = useState(false);
  /** Bumped when the timeline is (re)created so the editor remounts with a fresh undo history. */
  const [generation, setGeneration] = useState(0);
  const [createError, setCreateError] = useState<string>();

  const backLink = (
    <Link to={`/app/projects/${projectId}`} className="text-sm font-medium text-indigo-600 hover:underline">
      ← Back to project
    </Link>
  );

  if (page.error) {
    const notFound = page.error instanceof ApiError && page.error.status === 404;
    return (
      <div className="mx-auto max-w-7xl px-8 py-10">
        <Alert>{notFound ? 'This project does not exist or you no longer have access.' : page.error.message}</Alert>
        <div className="mt-4">{backLink}</div>
      </div>
    );
  }
  if (!page.data) return <Spinner label="Loading editor" />;

  const { project, data } = page.data;
  const setData = (next: TimelineData) => page.setData((d) => d && { ...d, data: next });
  const create = async (mediaId?: string) => {
    setCreating(true);
    setCreateError(undefined);
    try {
      setData(await timelineApi.create(projectId, mediaId));
      setGeneration((g) => g + 1);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not start the edit');
    } finally {
      setCreating(false);
    }
  };

  const videos = data.sources.filter((s) => s.kind === 'video');
  const timeline = data.timeline;
  let body;
  if (timeline) {
    body = (
      <EditorWorkspace
        // Starting over loads a fresh timeline; saving keeps the editor (and its undo history) as is.
        key={generation}
        data={{ ...data, timeline }}
        onSaved={setData}
        onStartOver={() => void create()}
      />
    );
  } else if (data.role === 'viewer') {
    body = <EmptyState title="Nothing to watch yet">An editor of this workspace hasn't started editing this video.</EmptyState>;
  } else if (videos.length === 0) {
    body = (
      <EmptyState
        title="Add a video first"
        action={
          <Link to={`/app/record?projectId=${projectId}`} className={buttonClasses()}>
            Record screen
          </Link>
        }
      >
        The editor cuts scenes from the videos in this project. Record your screen or upload a video, then come back here.
      </EmptyState>
    );
  } else {
    body = <StartEditing videos={videos} busy={creating} error={createError} onStart={(id) => void create(id)} />;
  }

  return (
    <div className="mx-auto max-w-7xl px-8 py-10">
      {backLink}
      <h1 className="mt-3 text-2xl font-semibold text-slate-900">Editor · {project.name}</h1>
      <p className="mt-1 text-sm text-slate-600">
        Cut your recording into scenes, trim and reorder them, and line the voiceover up with the picture.
      </p>
      {timeline && createError && (
        <div className="mt-4">
          <Alert>{createError}</Alert>
        </div>
      )}
      <div className="mt-6">{body}</div>
    </div>
  );
}

interface StartEditingProps {
  videos: TimelineData['sources'];
  busy: boolean;
  error?: string;
  onStart(mediaId: string): void;
}

function StartEditing({ videos, busy, error, onStart }: StartEditingProps) {
  const [mediaId, setMediaId] = useState(videos.at(-1)?.id ?? '');
  return (
    <div className="max-w-xl rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">Start editing</h2>
      <p className="mt-1 text-sm text-slate-600">
        Pick the video to start from. It becomes the first scene; if the project has a voiceover, it is added on its own track.
      </p>
      <label htmlFor="editor-source" className="mt-4 block text-sm font-medium text-slate-700">
        Video
      </label>
      <select
        id="editor-source"
        className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        value={mediaId}
        onChange={(e) => setMediaId(e.target.value)}
      >
        {videos.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.durationMs ? ` (${formatDuration(v.durationMs)})` : ''}
          </option>
        ))}
      </select>
      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}
      <Button className="mt-4" onClick={() => onStart(mediaId)} disabled={busy || !mediaId}>
        {busy ? 'Setting up…' : 'Start editing'}
      </Button>
    </div>
  );
}
