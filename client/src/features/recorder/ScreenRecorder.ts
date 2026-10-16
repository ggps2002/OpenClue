export type RecorderState = 'idle' | 'requesting' | 'recording' | 'paused' | 'stopped';
export type CaptureSurface = 'browser' | 'window' | 'monitor' | 'unknown';

/** A click during recording: `t` is ms of recorded time, `x`/`y` are 0..1 of the page viewport. */
export interface RecordedClick {
  t: number;
  x: number;
  y: number;
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  width: number;
  height: number;
  surface: CaptureSurface;
  hasAudio: boolean;
  clicks: RecordedClick[];
}

export interface StartOptions {
  microphone: boolean;
  /** Ask the browser to also share tab/system audio (only some browsers and surfaces support it). */
  systemAudio: boolean;
}

/** Browser APIs the recorder uses; tests pass fakes, the app uses the real globals. */
export interface RecorderEnvironment {
  mediaDevices: Pick<MediaDevices, 'getDisplayMedia' | 'getUserMedia'>;
  MediaRecorder: typeof MediaRecorder;
  /** Where clicks are listened for (the app window). */
  clickTarget: Window;
  now(): number;
}

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

/**
 * Records the screen (plus optional microphone) with getDisplayMedia + MediaRecorder and
 * collects click positions in this page while recording, for automatic zoom later.
 */
export class ScreenRecorder {
  private stateValue: RecorderState = 'idle';
  private listeners = new Set<(state: RecorderState) => void>();
  private streams: MediaStream[] = [];
  private audioContext: AudioContext | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private clicks: RecordedClick[] = [];
  private finished: Promise<RecordingResult> | null = null;
  // Recorded time excludes pauses: total = accumulated + (now - segmentStart) while recording.
  private accumulatedMs = 0;
  private segmentStart = 0;

  constructor(private readonly env: RecorderEnvironment = ScreenRecorder.browserEnvironment()) {}

  static isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
      typeof MediaRecorder !== 'undefined'
    );
  }

  static browserEnvironment(): RecorderEnvironment {
    return {
      mediaDevices: navigator.mediaDevices,
      MediaRecorder,
      clickTarget: window,
      now: () => performance.now(),
    };
  }

  /** The first container/codec combination the browser can record, or '' to let it choose. */
  static pickMimeType(isTypeSupported: (type: string) => boolean): string {
    return MIME_CANDIDATES.find((type) => isTypeSupported(type)) ?? '';
  }

  get state(): RecorderState {
    return this.stateValue;
  }

  get clickCount(): number {
    return this.clicks.length;
  }

  /** Subscribes to state changes; returns an unsubscribe function. */
  subscribe(listener: (state: RecorderState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  elapsedMs(): number {
    if (this.stateValue === 'recording') return this.accumulatedMs + (this.env.now() - this.segmentStart);
    return this.accumulatedMs;
  }

  /** Prompts for a screen to share and starts recording. Rejects if the user cancels the prompt. */
  async start(options: StartOptions): Promise<void> {
    if (this.stateValue !== 'idle' && this.stateValue !== 'stopped') throw new Error('Recording already in progress');
    this.reset();
    this.setState('requesting');
    try {
      const display = await this.env.mediaDevices.getDisplayMedia({ video: true, audio: options.systemAudio });
      this.streams.push(display);
      if (options.microphone) {
        this.streams.push(await this.env.mediaDevices.getUserMedia({ audio: true, video: false }));
      }
      const [videoTrack] = display.getVideoTracks();
      if (!videoTrack) throw new Error('No video track was shared');
      const audioTracks = this.streams.flatMap((s) => s.getAudioTracks());
      const stream = new MediaStream([videoTrack, ...this.mixAudio(audioTracks)]);
      this.beginRecording(stream, videoTrack);
    } catch (err) {
      this.releaseStreams();
      this.setState('idle');
      throw err;
    }
  }

  pause(): void {
    if (this.stateValue !== 'recording' || !this.recorder) return;
    this.recorder.pause();
    this.accumulatedMs = this.elapsedMs();
    this.setState('paused');
  }

  resume(): void {
    if (this.stateValue !== 'paused' || !this.recorder) return;
    this.recorder.resume();
    this.segmentStart = this.env.now();
    this.setState('recording');
  }

  /** Stops recording and resolves with the finished video. Safe to call more than once. */
  stop(): Promise<RecordingResult> {
    if (!this.finished) return Promise.reject(new Error('Nothing is being recorded'));
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.accumulatedMs = this.elapsedMs();
      this.recorder.stop();
    }
    return this.finished;
  }

  /** Stops and throws the recording away. */
  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.reset();
    this.setState('idle');
  }

  private beginRecording(stream: MediaStream, videoTrack: MediaStreamTrack): void {
    const mimeType = ScreenRecorder.pickMimeType((t) => this.env.MediaRecorder.isTypeSupported(t));
    const recorder = new this.env.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.recorder = recorder;
    const settings = videoTrack.getSettings();
    const hasAudio = stream.getAudioTracks().length > 0;

    this.finished = new Promise<RecordingResult>((resolve) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || 'video/webm';
        const result: RecordingResult = {
          blob: new Blob(this.chunks, { type }),
          mimeType: type,
          durationMs: Math.max(1, Math.round(this.accumulatedMs)),
          width: settings.width ?? 0,
          height: settings.height ?? 0,
          surface: toSurface(settings.displaySurface),
          hasAudio,
          clicks: [...this.clicks],
        };
        this.releaseStreams();
        this.setState('stopped');
        resolve(result);
      };
    });

    // The browser's own "Stop sharing" button ends the track; treat it like pressing stop.
    videoTrack.addEventListener('ended', () => void this.stop());
    this.env.clickTarget.addEventListener('pointerdown', this.handlePointerDown, true);
    // A timeslice keeps memory bounded and guarantees data even if the tab is closed mid-way.
    recorder.start(1000);
    this.segmentStart = this.env.now();
    this.setState('recording');
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (this.stateValue !== 'recording') return;
    const { innerWidth, innerHeight } = this.env.clickTarget;
    if (!innerWidth || !innerHeight) return;
    this.clicks.push({
      t: Math.round(this.elapsedMs()),
      x: clamp01(event.clientX / innerWidth),
      y: clamp01(event.clientY / innerHeight),
    });
  };

  /** Combines several audio tracks (mic + shared audio) into one; MediaRecorder records only the first. */
  private mixAudio(tracks: MediaStreamTrack[]): MediaStreamTrack[] {
    if (tracks.length <= 1 || typeof AudioContext === 'undefined') return tracks.slice(0, 1);
    const context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    for (const track of tracks) context.createMediaStreamSource(new MediaStream([track])).connect(destination);
    this.audioContext = context;
    return destination.stream.getAudioTracks();
  }

  private releaseStreams(): void {
    this.env.clickTarget.removeEventListener('pointerdown', this.handlePointerDown, true);
    for (const stream of this.streams) for (const track of stream.getTracks()) track.stop();
    this.streams = [];
    void this.audioContext?.close();
    this.audioContext = null;
  }

  private reset(): void {
    this.releaseStreams();
    this.recorder = null;
    this.chunks = [];
    this.clicks = [];
    this.finished = null;
    this.accumulatedMs = 0;
  }

  private setState(state: RecorderState): void {
    this.stateValue = state;
    for (const listener of this.listeners) listener(state);
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function toSurface(value: string | undefined): CaptureSurface {
  return value === 'browser' || value === 'window' || value === 'monitor' ? value : 'unknown';
}
