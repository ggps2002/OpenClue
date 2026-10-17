import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { buttonClasses } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { ApiError } from '../../lib/ApiClient';
import { useAsync } from '../../lib/useAsync';
import { projectsApi } from '../projects/projects.api';
import { scriptApi, type Script } from './script.api';
import { ScriptEditor } from './ScriptEditor';
import { ScriptGenerator } from './ScriptGenerator';

export function ScriptPage() {
  const { projectId = '' } = useParams();
  const page = useAsync(
    useCallback(async () => {
      const [project, script] = await Promise.all([projectsApi.get(projectId), scriptApi.get(projectId)]);
      return { project, script };
    }, [projectId]),
  );
  const [regenerating, setRegenerating] = useState(false);

  const backLink = (
    <Link to={`/app/projects/${projectId}`} className="text-sm font-medium text-indigo-600 hover:underline">
      ← Back to project
    </Link>
  );

  if (page.error) {
    const notFound = page.error instanceof ApiError && page.error.status === 404;
    return (
      <div className="mx-auto max-w-6xl px-8 py-10">
        <Alert>{notFound ? 'This project does not exist or you no longer have access.' : page.error.message}</Alert>
        <div className="mt-4">{backLink}</div>
      </div>
    );
  }
  if (!page.data) return <Spinner label="Loading script" />;

  const { project, script } = page.data;
  const canEdit = project.role !== 'viewer';
  const sources = project.media.filter((m) => m.kind === 'video' || m.kind === 'audio');
  const setScript = (next: Script) => {
    page.setData((d) => d && { ...d, script: next });
    setRegenerating(false);
  };

  let body;
  if (script && !regenerating) {
    body = (
      <ScriptEditor
        // A new draft or a save resets the editor's local copy.
        key={`${script.id}-${script.updatedAt}`}
        script={script}
        source={project.media.find((m) => m.id === script.sourceMediaId)}
        canEdit={canEdit}
        onSaved={setScript}
        onRegenerate={() => setRegenerating(true)}
      />
    );
  } else if (!canEdit) {
    body = <EmptyState title="No script yet">An editor of this workspace can write one from a recording.</EmptyState>;
  } else if (sources.length === 0) {
    body = (
      <EmptyState
        title="Add a recording first"
        action={
          <Link to={`/app/record?projectId=${project.id}`} className={buttonClasses()}>
            Record screen
          </Link>
        }
      >
        The script is written from the narration in a video or audio file. Record your screen or upload a file to this
        project, then come back here.
      </EmptyState>
    );
  } else {
    body = (
      <ScriptGenerator
        projectId={project.id}
        sources={sources}
        defaultSourceId={script?.sourceMediaId}
        replacing={Boolean(script)}
        onGenerated={setScript}
        onCancel={script ? () => setRegenerating(false) : undefined}
      />
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      {backLink}
      <h1 className="mt-3 text-2xl font-semibold text-slate-900">Script · {project.name}</h1>
      <p className="mt-1 text-sm text-slate-600">
        The narration for this video, split into timed segments. Each segment is what the voiceover says while that part
        of the recording plays.
      </p>
      <div className="mt-8">{body}</div>
    </div>
  );
}
