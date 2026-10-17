import type { CSSProperties } from 'react';
import type { CaptionStyle } from './captions.api';

const FONTS: Record<CaptionStyle['fontFamily'], string> = {
  sans: 'ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const PLACEMENT: Record<CaptionStyle['position'], CSSProperties> = {
  top: { top: '6%' },
  middle: { top: '50%', transform: 'translateY(-50%)' },
  bottom: { bottom: '7%' },
};

function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Where the caption block sits in the frame. Sizes use container query units of the 16:9 frame. */
export function captionBlockStyle(style: CaptionStyle): CSSProperties {
  return { position: 'absolute', left: '5%', right: '5%', display: 'flex', justifyContent: 'center', ...PLACEMENT[style.position] };
}

/** The caption text and its background box. */
export function captionTextStyle(style: CaptionStyle): CSSProperties {
  const outline = style.outline
    ? '0 0 0.3cqh #000, 0.15cqh 0.15cqh 0 #000, -0.15cqh -0.15cqh 0 #000, 0.15cqh -0.15cqh 0 #000, -0.15cqh 0.15cqh 0 #000'
    : undefined;
  return {
    fontFamily: FONTS[style.fontFamily],
    fontSize: `${style.fontSize * 100}cqh`,
    fontWeight: style.bold ? 700 : 500,
    textTransform: style.uppercase ? 'uppercase' : undefined,
    color: style.textColor,
    textShadow: outline,
    backgroundColor: style.backgroundOpacity > 0 ? rgba(style.backgroundColor, style.backgroundOpacity) : undefined,
    padding: '0.4em 0.6em',
    borderRadius: '0.25em',
    lineHeight: 1.25,
    textAlign: 'center',
    whiteSpace: 'pre-line',
    // Each line gets its own box, like broadcast captions.
    boxDecorationBreak: 'clone',
    WebkitBoxDecorationBreak: 'clone',
  };
}
