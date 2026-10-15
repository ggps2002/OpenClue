import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { ApiError } from '../../lib/ApiClient';

interface ProjectTitleProps {
  name: string;
  canEdit: boolean;
  onRename(name: string): Promise<void>;
}

/** The project name as a heading, switchable into an inline rename form. */
export function ProjectTitle({ name, canEdit, onRename }: ProjectTitleProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (draft === null) return;
    const next = draft.trim();
    if (!next) {
      setError('Name is required');
      return;
    }
    try {
      await onRename(next);
      setDraft(null);
      setError(undefined);
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues[0]?.message ?? err.message) : 'Could not rename the project');
    }
  };

  if (draft === null) {
    return (
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="truncate text-2xl font-semibold text-slate-900">{name}</h1>
        {canEdit && (
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setDraft(name)}>
            Rename
          </Button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <label htmlFor="project-name" className="sr-only">
        Project name
      </label>
      <input
        id="project-name"
        autoFocus
        value={draft}
        maxLength={120}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setDraft(null)}
        aria-invalid={error ? true : undefined}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-lg font-semibold focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
      />
      <Button type="submit">Save</Button>
      <Button variant="ghost" onClick={() => setDraft(null)}>
        Cancel
      </Button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
