import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { ApiError } from '../../lib/ApiClient';
import { projectsApi, type ProjectSummary } from './projects.api';

export function NewProjectForm({ workspaceId, onCreated }: { workspaceId: string; onCreated(project: ProjectSummary): void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Give your project a name');
      return;
    }
    setSaving(true);
    try {
      onCreated(await projectsApi.create(workspaceId, name.trim()));
      setName('');
      setError(undefined);
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues[0]?.message ?? err.message) : 'Could not create the project');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="min-w-60 flex-1">
        <TextField
          label="New project name"
          placeholder="e.g. Onboarding walkthrough"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error}
          maxLength={120}
        />
      </div>
      <Button type="submit" className="mt-6" disabled={saving}>
        {saving ? 'Creating…' : 'Create project'}
      </Button>
    </form>
  );
}
