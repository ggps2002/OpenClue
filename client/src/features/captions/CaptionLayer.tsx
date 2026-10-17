import { segmentAt } from '../script/segments';
import type { CaptionCue, CaptionStyle } from './captions.api';
import { captionBlockStyle, captionTextStyle } from './captionStyle';

interface CaptionLayerProps {
  cues: CaptionCue[];
  style: CaptionStyle;
  /** On the same clock as the cues. */
  timeMs: number;
}

/** Draws the caption showing at `timeMs` over a 16:9 frame (fill the frame with this layer). */
export function CaptionLayer({ cues, style, timeMs }: CaptionLayerProps) {
  const cue = segmentAt(cues, timeMs);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ containerType: 'size' }} data-testid="caption-layer">
      {cue && (
        <div style={captionBlockStyle(style)}>
          <span style={captionTextStyle(style)}>{cue.text}</span>
        </div>
      )}
    </div>
  );
}
