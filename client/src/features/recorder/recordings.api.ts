import { api } from '../../lib/ApiClient';
import type { MediaAsset } from '../media/media.api';
import type { RecordingResult } from './ScreenRecorder';

/** File extension for a recorder MIME type such as "video/webm;codecs=vp9". */
export function extensionFor(mimeType: string): string {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
}

export const recordingsApi = {
  upload: (workspaceId: string, result: RecordingResult, name: string, projectId?: string) => {
    const { blob, mimeType, durationMs, width, height, surface, hasAudio, clicks } = result;
    const form = new FormData();
    if (projectId) form.append('projectId', projectId);
    form.append('metadata', JSON.stringify({ durationMs, width, height, surface, hasAudio, clicks }));
    // The file goes last so the text fields are parsed before it.
    form.append('file', new File([blob], `${name}.${extensionFor(mimeType)}`, { type: mimeType.split(';')[0] }));
    return api.upload<{ media: MediaAsset }>(`/workspaces/${workspaceId}/recordings`, form).then((r) => r.media);
  },
};
