import { useEffect, useMemo, useRef, useState } from 'react';
import type { AudioSource, Timeline } from './Timeline';
import type { TimelineData } from './timeline.api';
import { TimelinePlayer, type PlayerState } from './TimelinePlayer';

/** Creates a TimelinePlayer bound to the returned video ref and mirrors its state into React. */
export function useTimelinePlayer(timeline: Timeline, data: Pick<TimelineData, 'sources' | 'voiceover'>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<TimelinePlayer | null>(null);
  const [state, setState] = useState<PlayerState>({ timeMs: 0, playing: false, sceneId: null });

  // The player lives as long as the component; it reads URLs through a ref so reloading the
  // sources (e.g. after a save) doesn't recreate it and lose the playhead.
  const urls = useRef(new Map<string, string>());
  const voiceoverUrl = useRef<string | null>(null);
  const urlsKey = JSON.stringify([data.sources.map((s) => [s.id, s.url]), data.voiceover?.url ?? null]);
  urls.current = new Map(data.sources.map((s) => [s.id, s.url]));
  voiceoverUrl.current = data.voiceover?.url ?? null;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const resolveUrl = (source: AudioSource) =>
      source.type === 'voiceover' ? voiceoverUrl.current : (urls.current.get(source.mediaId) ?? null);
    const player = new TimelinePlayer(video, { resolveUrl });
    playerRef.current = player;
    const unsubscribe = player.subscribe(setState);
    return () => {
      unsubscribe();
      player.destroy();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    playerRef.current?.setTimeline(timeline);
  }, [timeline, urlsKey]);

  const controls = useMemo(
    () => ({
      toggle: () => playerRef.current?.toggle(),
      pause: () => playerRef.current?.pause(),
      seek: (timeMs: number) => playerRef.current?.seek(timeMs),
    }),
    [],
  );
  return { videoRef, state, ...controls };
}
