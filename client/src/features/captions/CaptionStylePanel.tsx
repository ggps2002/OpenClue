import { useId } from 'react';
import { cn } from '../../lib/cn';
import { ColorField } from '../editor/fields';
import type { CaptionPreset, CaptionStyle } from './captions.api';
import { captionTextStyle } from './captionStyle';

interface CaptionStylePanelProps {
  style: CaptionStyle;
  presets: CaptionPreset[];
  disabled: boolean;
  onChange(style: CaptionStyle): void;
}

const selectClasses =
  'mt-1 block w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-50';

/** A small sample of a preset's look, drawn on a dark frame. */
export function PresetSwatch({ preset }: { preset: CaptionPreset }) {
  return (
    <span className="flex h-12 items-center justify-center overflow-hidden rounded-md bg-gradient-to-br from-slate-600 to-slate-800" style={{ containerType: 'size' }}>
      <span style={{ ...captionTextStyle({ ...preset.style, fontSize: 0.3 }), padding: '0.15em 0.4em' }}>Aa</span>
    </span>
  );
}

/** Preset picker plus every style value, which the user can change after picking a preset. */
export function CaptionStylePanel({ style, presets, disabled, onChange }: CaptionStylePanelProps) {
  const id = useId();
  const set = <K extends keyof CaptionStyle>(key: K, value: CaptionStyle[K]) => onChange({ ...style, [key]: value });
  const custom = !presets.some((p) => p.id === style.preset && JSON.stringify(p.style) === JSON.stringify(style));

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <h2 id={`${id}-title`} className="text-sm font-semibold text-slate-900">
          Caption style
        </h2>
        <p className="text-xs text-slate-500">Pick a preset, then adjust it to match your brand.{custom && ' (Customised)'}</p>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            disabled={disabled}
            title={preset.description}
            aria-pressed={style.preset === preset.id}
            onClick={() => onChange(preset.style)}
            className={cn(
              'rounded-lg border p-1 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-60',
              style.preset === preset.id ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300',
            )}
          >
            <PresetSwatch preset={preset} />
            <span className="mt-1 block">{preset.label}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${id}-font`} className="text-xs font-medium text-slate-600">
            Font
          </label>
          <select id={`${id}-font`} className={selectClasses} disabled={disabled} value={style.fontFamily} onChange={(e) => set('fontFamily', e.target.value as CaptionStyle['fontFamily'])}>
            <option value="sans">Sans serif</option>
            <option value="serif">Serif</option>
            <option value="mono">Monospace</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-position`} className="text-xs font-medium text-slate-600">
            Position
          </label>
          <select id={`${id}-position`} className={selectClasses} disabled={disabled} value={style.position} onChange={(e) => set('position', e.target.value as CaptionStyle['position'])}>
            <option value="bottom">Bottom</option>
            <option value="middle">Middle</option>
            <option value="top">Top</option>
          </select>
        </div>
        <div className="col-span-2">
          <label htmlFor={`${id}-size`} className="text-xs font-medium text-slate-600">
            Text size · {Math.round(style.fontSize * 1000) / 10}% of the frame height
          </label>
          <input id={`${id}-size`} type="range" className="block w-full accent-indigo-600" min={0.03} max={0.12} step={0.005} disabled={disabled} value={style.fontSize} onChange={(e) => set('fontSize', Number(e.target.value))} />
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-700">
        <Toggle label="Bold" checked={style.bold} disabled={disabled} onChange={(v) => set('bold', v)} />
        <Toggle label="Uppercase" checked={style.uppercase} disabled={disabled} onChange={(v) => set('uppercase', v)} />
        <Toggle label="Outline" checked={style.outline} disabled={disabled} onChange={(v) => set('outline', v)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ColorField label="Text color" value={style.textColor} disabled={disabled} onChange={(v) => v && set('textColor', v)} />
        <ColorField label="Box color" value={style.backgroundColor} disabled={disabled} onChange={(v) => v && set('backgroundColor', v)} />
        <div className="col-span-2">
          <label htmlFor={`${id}-opacity`} className="text-xs font-medium text-slate-600">
            Box opacity · {Math.round(style.backgroundOpacity * 100)}%{style.backgroundOpacity === 0 && ' (no box)'}
          </label>
          <input id={`${id}-opacity`} type="range" className="block w-full accent-indigo-600" min={0} max={1} step={0.05} disabled={disabled} value={style.backgroundOpacity} onChange={(e) => set('backgroundOpacity', Number(e.target.value))} />
        </div>
      </div>
    </section>
  );
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange(value: boolean): void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
