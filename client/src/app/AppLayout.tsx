import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Logo } from '../components/ui/Logo';
import { cn } from '../lib/cn';
import { useAuth } from './AuthProvider';

interface NavItem {
  label: string;
  to: string;
  /** Planned sections render disabled until their milestone ships. */
  soon?: boolean;
  /** Only highlight on an exact match (otherwise nested routes count too). */
  end?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/app', end: true },
  { label: 'Projects', to: '/app/projects' },
  { label: 'Media library', to: '/app/media' },
  { label: 'Style templates', to: '/app/templates', soon: true },
  { label: 'Brand kit', to: '/app/brand', soon: true },
];

export function AppLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const workspace = user?.workspaces[0];

  const handleSignOut = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="px-5 py-5">
          <Logo className="text-slate-900" />
          {workspace && <p className="mt-1 truncate text-xs text-slate-500">{workspace.name}</p>}
        </div>
        <nav aria-label="Main" className="flex-1 space-y-1 px-3">
          {navItems.map((item) =>
            item.soon ? (
              <span
                key={item.to}
                aria-disabled="true"
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-400"
              >
                {item.label}
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase">Soon</span>
              </span>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'block rounded-lg px-3 py-2 text-sm font-medium',
                    isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-100',
                  )
                }
              >
                {item.label}
              </NavLink>
            ),
          )}
        </nav>
        <div className="border-t border-slate-200 p-4">
          <p className="truncate text-sm font-medium text-slate-900">{user?.name}</p>
          <p className="truncate text-xs text-slate-500">{user?.email}</p>
          <Button variant="secondary" className="mt-3 w-full" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
