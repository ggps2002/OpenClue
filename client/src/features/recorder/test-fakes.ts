import { vi } from 'vitest';
import type { RecorderEnvironment } from './ScreenRecorder';

/** Minimal stand-ins for the browser media APIs, shared by recorder tests. */
export class FakeTrack extends EventTarget {
  stopped = false;
  constructor(
    readonly kind: 'video' | 'audio',
    private readonly settings: MediaTrackSettings = {},
  ) {
    super();
  }
  getSettings() {
    return this.settings;
  }
  stop() {
    this.stopped = true;
  }
}

export class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
}

export class FakeMediaRecorder {
  static isTypeSupported = (type: string) => type === 'video/webm';
  static last: FakeMediaRecorder | undefined;
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    readonly stream: FakeStream,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? '';
    FakeMediaRecorder.last = this;
  }
  start() {
    this.state = 'recording';
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['chunk'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

/** Builds a fake environment with a controllable clock; installs FakeStream as global MediaStream. */
export function fakeEnvironment(options: { surface?: string; micDenied?: boolean } = {}) {
  vi.stubGlobal('MediaStream', FakeStream);
  const clock = { now: 0 };
  const videoTrack = new FakeTrack('video', { width: 1920, height: 1080, displaySurface: options.surface ?? 'browser' });
  const micTrack = new FakeTrack('audio');
  const mediaDevices = {
    getDisplayMedia: vi.fn(() => Promise.resolve(new FakeStream([videoTrack]) as unknown as MediaStream)),
    getUserMedia: vi.fn(() =>
      options.micDenied
        ? Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
        : Promise.resolve(new FakeStream([micTrack]) as unknown as MediaStream),
    ),
  };
  const env: RecorderEnvironment = {
    mediaDevices,
    MediaRecorder: FakeMediaRecorder as unknown as typeof MediaRecorder,
    clickTarget: window,
    now: () => clock.now,
  };
  return { env, clock, videoTrack, micTrack, mediaDevices };
}
