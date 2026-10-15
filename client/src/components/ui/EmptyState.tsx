import type { ReactNode } from 'react';

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-slate-300 bg-white px-6 py-14 text-center">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {children && <div className="mt-2 max-w-md text-sm text-slate-600">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
