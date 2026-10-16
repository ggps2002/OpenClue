/** Drift (in seconds) tolerated before the voiceover track is snapped back to the video. */
const MAX_DRIFT_S = 0.3;

/**
 * Plays `track` in lockstep with `media` (play, pause, seek, speed) and mutes the media's own audio.
 * Returns a function that undoes it.
 */
export function syncTrack(media: HTMLMediaElement, track: HTMLMediaElement): () => void {
  const align = () => {
    if (Math.abs(track.currentTime - media.currentTime) > MAX_DRIFT_S) track.currentTime = media.currentTime;
  };
  const play = () => {
    align();
    void track.play()?.catch(() => undefined);
  };
  const pause = () => track.pause();
  const rate = () => {
    track.playbackRate = media.playbackRate;
  };
  const handlers: [string, () => void][] = [
    ['play', play],
    ['pause', pause],
    ['seeked', align],
    ['timeupdate', align],
    ['ratechange', rate],
  ];

  const wasMuted = media.muted;
  media.muted = true;
  rate();
  handlers.forEach(([event, fn]) => media.addEventListener(event, fn));
  if (!media.paused) play();

  return () => {
    handlers.forEach(([event, fn]) => media.removeEventListener(event, fn));
    track.pause();
    media.muted = wasMuted;
  };
}
