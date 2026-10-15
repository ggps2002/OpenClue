import { useAuth } from '../../app/AuthProvider';

export function DashboardPage() {
  const { user } = useAuth();
  const firstName = user?.name.split(' ')[0];
  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <h1 className="text-2xl font-semibold text-slate-900">Welcome{firstName ? `, ${firstName}` : ''}</h1>
      <p className="mt-1 text-sm text-slate-600">Your videos and guides will show up here.</p>

      <div className="mt-8 flex flex-col items-center rounded-2xl border-2 border-dashed border-slate-300 bg-white px-6 py-16 text-center">
        <h2 className="text-lg font-semibold text-slate-900">No projects yet</h2>
        <p className="mt-2 max-w-md text-sm text-slate-600">
          Soon you’ll be able to record your screen, upload a video or deck, or start from a prompt right here.
        </p>
      </div>
    </div>
  );
}
