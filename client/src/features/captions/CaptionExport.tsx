import { useId, useState } from 'react';
import { Button, buttonClasses } from '../../components/ui/Button';
import { captionsApi, type CaptionTiming } from './captions.api';

/** Download links for SRT and WebVTT files, timed to the original recording or to the edit. */
export function CaptionExport({ projectId, disabled }: { projectId: string; disabled: boolean }) {
  const id = useId();
  const [timing, setTiming] = useState<CaptionTiming>('auto');
  const link = (format: 'srt' | 'vtt', label: string) =>
    disabled ? (
      <Button variant="secondary" className="px-3 py-1.5" disabled>
        {label}
      </Button>
    ) : (
      <a href={captionsApi.exportUrl(projectId, format, timing)} download className={buttonClasses('secondary', 'px-3 py-1.5')}>
        {label}
      </a>
    );
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 id={`${id}-title`} className="text-sm font-semibold text-slate-900">
        Export subtitles
      </h2>
      <div>
        <label htmlFor={`${id}-timing`} className="text-xs font-medium text-slate-600">
          Timing
        </label>
        <select
          id={`${id}-timing`}
          className="mt-1 block w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          value={timing}
          onChange={(e) => setTiming(e.target.value as CaptionTiming)}
        >
          <option value="auto">Match the edited video when there is one</option>
          <option value="script">Original recording</option>
        </select>
      </div>
      <div className="flex gap-2">
        {link('srt', 'Download SRT')}
        {link('vtt', 'Download VTT')}
      </div>
      {disabled && <p className="text-xs text-slate-500">Save your changes to export them.</p>}
    </section>
  );
}
