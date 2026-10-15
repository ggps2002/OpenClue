import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useCurrentWorkspace } from '../../app/AuthProvider';
import { Alert } from '../../components/ui/Alert';
import { buttonClasses } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Spinner } from '../../components/ui/Spinner';
import { useAsync } from '../../lib/useAsync';
import { ProjectGrid } from '../projects/ProjectCard';
import { projectsApi } from '../projects/projects.api';

const RECENT_COUNT = 6;

export function DashboardPage() {
  const { user } = useAuth();
  const workspace = useCurrentWorkspace();
  const projects = useAsync(useCallback(() => projectsApi.list(workspace.id), [workspace.id]));
  const firstName = user?.name.split(' ')[0];

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <PageHeader
        title={`Welcome${firstName ? `, ${firstName}` : ''}`}
        description="Pick up where you left off, or start something new."
        actions={
          <Link to="/app/projects" className={buttonClasses('primary')}>
            New project
          </Link>
        }
      />

      <section aria-labelledby="recent-projects" className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="recent-projects" className="text-lg font-semibold text-slate-900">
            Recent projects
          </h2>
          {projects.data && projects.data.length > RECENT_COUNT && (
            <Link to="/app/projects" className="text-sm font-medium text-indigo-600 hover:underline">
              View all
            </Link>
          )}
        </div>
        {projects.error ? (
          <Alert>Could not load projects. {projects.error.message}</Alert>
        ) : !projects.data ? (
          <Spinner label="Loading projects" />
        ) : projects.data.length === 0 ? (
          <EmptyState
            title="No projects yet"
            action={
              <Link to="/app/projects" className={buttonClasses('primary')}>
                Create your first project
              </Link>
            }
          >
            A project collects the recordings, screenshots and documents for one video or guide.
          </EmptyState>
        ) : (
          <ProjectGrid projects={projects.data.slice(0, RECENT_COUNT)} />
        )}
      </section>
    </div>
  );
}
