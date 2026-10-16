import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentWorkspace } from '../../app/AuthProvider';
import { Alert } from '../../components/ui/Alert';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Spinner } from '../../components/ui/Spinner';
import { useAsync } from '../../lib/useAsync';
import { NewProjectForm } from './NewProjectForm';
import { ProjectGrid } from './ProjectCard';
import { projectsApi } from './projects.api';

export function ProjectsPage() {
  const workspace = useCurrentWorkspace();
  const navigate = useNavigate();
  const projects = useAsync(useCallback(() => projectsApi.list(workspace.id), [workspace.id]));
  const canEdit = workspace.role !== 'viewer';

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <PageHeader title="Projects" description="Each project holds the recordings and files for one video or guide." />
      {canEdit && (
        <div className="mt-6">
          <NewProjectForm workspaceId={workspace.id} onCreated={(p) => navigate(`/app/projects/${p.id}`)} />
        </div>
      )}
      <div className="mt-8">
        {projects.error ? (
          <Alert>Could not load projects. {projects.error.message}</Alert>
        ) : !projects.data ? (
          <Spinner label="Loading projects" />
        ) : projects.data.length === 0 ? (
          <EmptyState title="No projects yet">Name your first project above to start adding recordings and files.</EmptyState>
        ) : (
          <ProjectGrid projects={projects.data} />
        )}
      </div>
    </div>
  );
}
