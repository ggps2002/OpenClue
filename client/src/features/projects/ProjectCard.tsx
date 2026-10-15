import { Link } from 'react-router-dom';
import { formatRelative } from '../../lib/format';
import type { ProjectSummary } from './projects.api';

export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <li>
      <Link
        to={`/app/projects/${project.id}`}
        className="block rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-indigo-600"
      >
        <div className="mb-3 flex aspect-video items-center justify-center rounded-lg bg-gradient-to-br from-indigo-100 to-sky-100">
          <span className="text-3xl font-bold text-indigo-300" aria-hidden="true">
            {project.name.charAt(0).toUpperCase()}
          </span>
        </div>
        <p className="truncate font-medium text-slate-900">{project.name}</p>
        <p className="text-xs text-slate-500">
          {project.mediaCount} file{project.mediaCount === 1 ? '' : 's'} · Updated {formatRelative(project.updatedAt)}
        </p>
      </Link>
    </li>
  );
}

export function ProjectGrid({ projects }: { projects: ProjectSummary[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => (
        <ProjectCard key={p.id} project={p} />
      ))}
    </ul>
  );
}
