import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import type { ProjectSummary } from '../projects/projects.api';
import type { StartOptions } from './ScreenRecorder';

interface RecorderSetupProps {
  projects: ProjectSummary[];
  projectId: string;
  onProjectChange(projectId: string): void;
  starting: boolean;
  onStart(options: StartOptions): void;
}

export function RecorderSetup({ projects, projectId, onProjectChange, starting, onStart }: RecorderSetupProps) {
  const [microphone, setMicrophone] = useState(true);
  const [systemAudio, setSystemAudio] = useState(false);

  return (
    <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="space-y-1">
        <label htmlFor="record-project" className="block text-sm font-medium text-slate-700">
          Save to project
        </label>
        <select
          id="record-project"
          value={projectId}
          onChange={(e) => onProjectChange(e.target.value)}
          className="block w-full max-w-sm rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">No project (media library only)</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-slate-700">Audio</legend>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={microphone} onChange={(e) => setMicrophone(e.target.checked)} />
          Record microphone
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={systemAudio} onChange={(e) => setSystemAudio(e.target.checked)} />
          Include tab or system audio (when your browser offers it)
        </label>
      </fieldset>

      <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
        <p>
          After you press start, your browser asks which screen, window or tab to share. While recording, OpenClue notes
          where you click inside this tab so it can suggest zooms later. Clicks in other apps aren’t visible to a web page;
          you can add those focus points by hand in the editor.
        </p>
      </div>

      <Button onClick={() => onStart({ microphone, systemAudio })} disabled={starting}>
        {starting ? 'Waiting for your browser…' : 'Start recording'}
      </Button>
    </div>
  );
}
