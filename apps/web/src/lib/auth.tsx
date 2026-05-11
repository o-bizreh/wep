import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { fetchApi } from './api';

export type SystemRole = 'manager' | 'team_lead' | 'engineer';

export interface AuthUser {
  username: string | null;
  email: string | null;
  isDevOps: boolean;
  role: SystemRole;
  teamId: string | null;
  loading: boolean;
}

const defaultAuth: AuthUser = {
  username: null,
  email: null,
  isDevOps: false,
  role: 'engineer',
  teamId: null,
  loading: true,
};

const AuthContext = createContext<AuthUser>(defaultAuth);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthUser>(defaultAuth);

  useEffect(() => {
    fetchApi<Omit<AuthUser, 'loading'>>('/auth/me')
      .then(data => setAuth({ ...data, loading: false }))
      .catch(() => setAuth({ ...defaultAuth, loading: false }));
  }, []);

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthUser {
  return useContext(AuthContext);
}
