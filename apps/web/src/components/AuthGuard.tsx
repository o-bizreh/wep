import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { oauthApi } from '../lib/api';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    oauthApi.getStatus()
      .then((s) => {
        if (!s.aws.connected) {
          navigate('/login', { replace: true, state: { from: location.pathname } });
        } else {
          setReady(true);
        }
      })
      .catch(() => {
        navigate('/login', { replace: true });
      });
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-[#0b0c10]">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-300 dark:text-zinc-600" />
      </div>
    );
  }

  return <>{children}</>;
}
