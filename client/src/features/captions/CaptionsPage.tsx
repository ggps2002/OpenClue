import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { buttonClasses } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { ApiError } from '../../lib/ApiClient';
import { useAsync } from '../../lib/useAsync';
import { projectsApi } from '../projects/projects.api';
import { scriptApi } from '../script/script.api';
import { voiceoverApi } from '../voiceover/voiceover.api';
import { captionsApi, type Captions } from './captions.api';
import { CaptionsEditor } from './CaptionsEditor';
import { CaptionsGenerator } from './CaptionsGenerator';

export function CaptionsPage() {
  const { projectId = '' } = useParams();
  const page = useAsync(
    useCallback(async () => {
      const [project, script, voiceover, { captions }, { presets }] = await Promise.all([
        projectsApi.get(projectId),
        scriptApi.get(projectId),
        voiceoverApi.get(projectId),
        captionsApi.get(projectId),
        captionsApi.presets(),
      ]);
      return { project, script, voiceover, captions, presets };
    }, [projectId]),
  );
  const [rebuilding, setRebuilding] = useState(false);

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
  if (!page.data) return <Spinner label="Loading captions" />;

  const { project, script, voiceover, captions, presets } = page.data;
  const canEdit = project.role !== 'viewer';
  const voiceoverUrl = voiceover?.trackUrl ?? null;
  const setCaptions = (next: Captions) => {
    page.setData((d) => d && { ...d, captions: next });
    setRebuilding(false);
  };

  let body;
  if (!script) {
    body = (
      <EmptyState
        title="Write the script first"
        action={
          <Link to={`/app/projects/${project.id}/script`} className={buttonClasses()}>
            Go to the script
          </Link>
        }
      >
        Captions are made from the narration script, timed to its voiceover.
      </EmptyState>
    );
  } else if (captions && !rebuilding) {
    body = (
      <CaptionsEditor
        // A rebuild or a save resets the editor's local copy.
        key={`${captions.id}-${captions.updatedAt}`}
        captions={captions}
        presets={presets}
        source={project.media.find((m) => m.id === captions.sourceMediaId)}
        voiceoverUrl={voiceoverUrl}
        canEdit={canEdit}
        onSaved={setCaptions}
        onRebuild={() => setRebuilding(true)}
      />
    );
  } else if (!canEdit) {
    body = <EmptyState title="No captions yet">An editor of this workspace can make them from the script.</EmptyState>;
  } else {
    body = (
      <CaptionsGenerator
        projectId={project.id}
        presets={presets}
        current={captions}
        hasVoiceover={Boolean(voiceover?.segments.some((s) => s.status === 'ready'))}
        onGenerated={setCaptions}
        onCancel={captions ? () => setRebuilding(false) : undefined}
      />
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      {backLink}
      <h1 className="mt-3 text-2xl font-semibold text-slate-900">Captions · {project.name}</h1>
      <p className="mt-1 text-sm text-slate-600">
        Short on-screen lines built from the script and timed to the voiceover. Style them to match your brand, then show
        them in the editor or download subtitle files.
      </p>
      <div className="mt-8">{body}</div>
    </div>
  );
}
