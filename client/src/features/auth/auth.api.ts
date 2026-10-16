import { api } from '../../lib/ApiClient';

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  workspaces: WorkspaceSummary[];
}

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

export interface SignInInput {
  email: string;
  password: string;
}

export const authApi = {
  me: () => api.get<{ user: User }>('/auth/me').then((r) => r.user),
  signUp: (input: SignUpInput) => api.post<{ user: User }>('/auth/signup', input).then((r) => r.user),
  signIn: (input: SignInInput) => api.post<{ user: User }>('/auth/signin', input).then((r) => r.user),
  signOut: () => api.post<void>('/auth/signout'),
};
