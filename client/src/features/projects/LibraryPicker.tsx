import { useCallback, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useAsync } from '../../lib/useAsync';
import { mediaApi } from '../media/media.api';

interface LibraryPickerProps {
  workspaceId: string;
  /** Media already in the project; hidden from the list. */
  excludeIds: string[];
  onPick(mediaId: string): Promise<void>;
}

/** Adds an existing media-library file to the project. */
export function LibraryPicker({ workspaceId, excludeIds, onPick }: LibraryPickerProps) {
  const library = useAsync(useCallback(() => mediaApi.list(workspaceId), [workspaceId]));
  const [selected, setSelected] = useState('');
  const options = (library.data ?? []).filter((m) => !excludeIds.includes(m.id));
  if (options.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="library-picker" className="sr-only">
        Add from media library
      </label>
      <select
        id="library-picker"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="max-w-64 rounded-lg border border-slate-300 px-2 py-2 text-sm"
      >
        <option value="">Add from media library…</option>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <Button
        variant="secondary"
        disabled={!selected}
        onClick={() => {
          void onPick(selected).then(() => {
            setSelected('');
            library.reload();
          });
        }}
      >
        Add
      </Button>
    </div>
  );
}
