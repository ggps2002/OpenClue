import { useCallback, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCurrentWorkspace } from '../../app/AuthProvider';
import { Alert } from '../../components/ui/Alert';
import { PageHeader } from '../../components/ui/PageHeader';
import { ApiError } from '../../lib/ApiClient';
import { useAsync } from '../../lib/useAsync';
import { projectsApi, type ProjectSummary } from '../projects/projects.api';
import { RecorderSetup } from './RecorderSetup';
import { RecordingControls } from './RecordingControls';
import { RecordingReview } from './RecordingReview';
import { recordingsApi } from './recordings.api';
import { ScreenRecorder } from './ScreenRecorder';
import { useScreenRecorder } from './useScreenRecorder';

function defaultRecordingName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Recording ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}`;
}

export function RecordPage() {
  const workspace = useCurrentWorkspace();
  const [params] = useSearchParams();
  const [projectId, setProjectId] = useState(params.get('projectId') ?? '');
  const projects = useAsync(useCallback(() => projectsApi.list(workspace.id), [workspace.id]));

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <PageHeader
        title="Record your screen"
        description="Capture a walkthrough with your voice. You’ll turn it into a polished video and guide in later steps."
      />
      <div className="mt-8">
        {!ScreenRecorder.isSupported() ? (
          <Alert>
            This browser can’t record the screen. Use a recent desktop version of Chrome, Edge or Firefox, or upload a
            recording from the media library instead.
          </Alert>
        ) : workspace.role === 'viewer' ? (
          <Alert>You have view-only access to this workspace, so you can’t add recordings.</Alert>
        ) : (
          <Recorder
            workspaceId={workspace.id}
            projectId={projectId}
            onProjectChange={setProjectId}
            projects={projects.data ?? []}
          />
        )}
      </div>
    </div>
  );
}

interface RecorderProps {
  workspaceId: string;
  projectId: string;
  onProjectChange(projectId: string): void;
  projects: ProjectSummary[];
}

function Recorder({ workspaceId, projectId, onProjectChange, projects }: RecorderProps) {
  const navigate = useNavigate();
  const recorder = useScreenRecorder();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [defaultName] = useState(() => defaultRecordingName());

  const handleSave = async (name: string) => {
    if (!recorder.result) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await recordingsApi.upload(workspaceId, recorder.result, name, projectId || undefined);
      navigate(projectId ? `/app/projects/${projectId}` : '/app/media');
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not save the recording. Try again.');
      setSaving(false);
    }
  };

  const error = recorder.error ?? saveError;
  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {recorder.result ? (
        <RecordingReview
          result={recorder.result}
          defaultName={defaultName}
          saving={saving}
          onSave={(name) => void handleSave(name)}
          onDiscard={recorder.discard}
        />
      ) : recorder.state === 'recording' || recorder.state === 'paused' ? (
        <RecordingControls
          paused={recorder.state === 'paused'}
          elapsedMs={recorder.elapsedMs}
          clickCount={recorder.clickCount}
          onPause={recorder.pause}
          onResume={recorder.resume}
          onStop={recorder.stop}
        />
      ) : recorder.state === 'stopped' ? (
        <p className="text-sm text-slate-600">Finishing the recording…</p>
      ) : (
        <RecorderSetup
          projects={projects}
          projectId={projectId}
          onProjectChange={onProjectChange}
          starting={recorder.state === 'requesting'}
          onStart={(options) => void recorder.start(options)}
        />
      )}
    </div>
  );
}
