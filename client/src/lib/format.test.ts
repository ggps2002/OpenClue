import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, formatRelative, formatTimecode } from './format';

describe('formatBytes', () => {
  it('picks a sensible unit and precision', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB');
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  it('describes recent times relatively', () => {
    expect(formatRelative('2026-10-15T11:59:30Z', now)).toBe('just now');
    expect(formatRelative('2026-10-15T11:55:00Z', now)).toBe('5 min ago');
    expect(formatRelative('2026-10-15T09:00:00Z', now)).toBe('3 hr ago');
    expect(formatRelative('2026-10-14T12:00:00Z', now)).toBe('1 day ago');
  });
});

describe('formatDuration', () => {
  it('formats as a clock', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_400)).toBe('1:05');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
  });
});

describe('formatTimecode', () => {
  it('adds tenths of a second', () => {
    expect(formatTimecode(0)).toBe('0:00.0');
    expect(formatTimecode(65_430)).toBe('1:05.4');
    expect(formatTimecode(-5)).toBe('0:00.0');
  });
});
