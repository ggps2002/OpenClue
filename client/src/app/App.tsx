import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SignInPage } from '../features/auth/SignInPage';
import { SignUpPage } from '../features/auth/SignUpPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { LandingPage } from '../features/landing/LandingPage';
import { MediaLibraryPage } from '../features/media/MediaLibraryPage';
import { ProjectDetailPage } from '../features/projects/ProjectDetailPage';
import { ProjectsPage } from '../features/projects/ProjectsPage';
import { RecordPage } from '../features/recorder/RecordPage';
import { AppLayout } from './AppLayout';
import { AuthProvider } from './AuthProvider';
import { RequireAuth } from './RequireAuth';

/** Opt in to React Router v7 behaviour now so the upgrade is a no-op. */
export const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="media" element={<MediaLibraryPage />} />
        <Route path="record" element={<RecordPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter future={routerFuture}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
