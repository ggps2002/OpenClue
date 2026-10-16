import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authApi, type SignInInput, type SignUpInput, type User, type WorkspaceSummary } from '../features/auth/auth.api';
import { ApiError } from '../lib/ApiClient';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signIn(input: SignInInput): Promise<void>;
  signUp(input: SignUpInput): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    authApi
      .me()
      .then((u) => active && setUser(u))
      .catch((err: unknown) => {
        if (!(err instanceof ApiError && err.status === 401)) console.error(err);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async (input: SignInInput) => setUser(await authApi.signIn(input)), []);
  const signUp = useCallback(async (input: SignUpInput) => setUser(await authApi.signUp(input)), []);
  const signOut = useCallback(async () => {
    await authApi.signOut();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, signIn, signUp, signOut }), [user, loading, signIn, signUp, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** The workspace the signed-in user is working in. Only valid inside the signed-in app shell. */
export function useCurrentWorkspace(): WorkspaceSummary {
  const { user } = useAuth();
  const workspace = user?.workspaces[0];
  if (!workspace) throw new Error('useCurrentWorkspace needs a signed-in user with a workspace');
  return workspace;
}
