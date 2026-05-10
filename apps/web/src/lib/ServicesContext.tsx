/**
 * ServicesContext — shared, app-wide cache for the catalog service list.
 *
 * Either CatalogPage or DeploymentFeedPage may be the first to need this data.
 * Whichever mounts first calls `ensureLoaded()`; subsequent callers get the
 * already-resolved promise and never trigger a second fetch.
 */
import { createContext, useContext, useRef, useState, useCallback, type ReactNode } from 'react';
import { catalogApi } from './api';

export interface ServiceSummary {
  serviceId: string;
  serviceName: string;
  repositoryUrl: string;
  runtimeType: string;
  ownerTeam?: { teamId: string; teamName: string };
  environments: string[];
  healthStatus: { status: string };
  awsEnriched: boolean;
}

interface ServicesState {
  services: ServiceSummary[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

interface ServicesContextValue extends ServicesState {
  ensureLoaded: () => void;
  refresh: () => void;
  /** Called by CatalogPage to publish its already-fetched list into the shared cache. */
  setFromExternal: (services: ServiceSummary[]) => void;
}

const ServicesContext = createContext<ServicesContextValue | null>(null);

export function ServicesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ServicesState>({
    services: [],
    loading: false,
    loaded: false,
    error: null,
  });

  // Single in-flight promise — guarantees exactly one fetch regardless of
  // how many consumers call ensureLoaded() concurrently.
  const fetchPromise = useRef<Promise<void> | null>(null);

  const doFetch = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const result = await catalogApi.listServices({ limit: '500' });
      setState({
        services: (result.items as ServiceSummary[]),
        loading: false,
        loaded: true,
        error: null,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        loaded: true,
        error: err instanceof Error ? err.message : 'Failed to load services',
      }));
    }
  }, []);

  const ensureLoaded = useCallback(() => {
    if (state.loaded || state.loading) return;
    if (!fetchPromise.current) {
      fetchPromise.current = doFetch();
    }
  }, [state.loaded, state.loading, doFetch]);

  const refresh = useCallback(() => {
    fetchPromise.current = null;
    setState({ services: [], loading: false, loaded: false, error: null });
    fetchPromise.current = doFetch();
  }, [doFetch]);

  const setFromExternal = useCallback((services: ServiceSummary[]) => {
    // Only update if the incoming list is non-empty (avoids overwriting with
    // a stale empty array during early render cycles).
    if (services.length === 0) return;
    fetchPromise.current = Promise.resolve(); // mark as satisfied
    setState({ services, loading: false, loaded: true, error: null });
  }, []);

  return (
    <ServicesContext.Provider value={{ ...state, ensureLoaded, refresh, setFromExternal }}>
      {children}
    </ServicesContext.Provider>
  );
}

export function useServices(): ServicesContextValue {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error('useServices must be used within ServicesProvider');
  return ctx;
}
