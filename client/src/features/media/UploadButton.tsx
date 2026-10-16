import { useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { ApiError } from '../../lib/ApiClient';
import { mediaApi, UPLOAD_ACCEPT, type MediaAsset } from './media.api';

interface UploadButtonProps {
  workspaceId: string;
  projectId?: string;
  onUploaded(asset: MediaAsset): void;
  onError(message: string): void;
  label?: string;
}

/** Picks one or more files and uploads them one after another. */
export function UploadButton({ workspaceId, projectId, onUploaded, onError, label = 'Upload files' }: UploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const handleFiles = async (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    setProgress({ done: 0, total: list.length });
    for (const [index, file] of list.entries()) {
      try {
        onUploaded(await mediaApi.upload(workspaceId, file, projectId));
      } catch (err) {
        onError(`${file.name}: ${err instanceof ApiError ? err.message : 'Upload failed'}`);
      }
      setProgress({ done: index + 1, total: list.length });
    }
    setProgress(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={UPLOAD_ACCEPT}
        className="sr-only"
        aria-label={label}
        tabIndex={-1}
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <Button onClick={() => inputRef.current?.click()} disabled={progress !== null}>
        {progress ? `Uploading ${progress.done + 1} of ${progress.total}…` : label}
      </Button>
    </>
  );
}
