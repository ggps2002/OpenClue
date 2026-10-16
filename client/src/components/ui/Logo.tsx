import { cn } from '../../lib/cn';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-bold tracking-tight', className)}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#4f46e5" />
        <circle cx="14" cy="14" r="6.5" fill="none" stroke="#fff" strokeWidth="3" />
        <path d="M19 19l6 6" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <path d="M12.5 11.5v5l4-2.5z" fill="#fff" />
      </svg>
      OpenClue
    </span>
  );
}
