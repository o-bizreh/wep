import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { oauthApi } from '../lib/api';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function CredentialsExpiredBanner() {
  const [expired, setExpired] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    try {
      const status = await oauthApi.getStatus();
      const awsExpired = status.aws.connected && status.aws.expiresAt
        ? new Date(status.aws.expiresAt) <= new Date()
        : false;
      setExpired(awsExpired);
      if (awsExpired) setDismissed(false);
    } catch { /* network error — don't flag as expired */ }
  }, []);

  useEffect(() => {
    void check();
    const id = setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [check]);

  if (!expired || dismissed) return null;

  return (
    <div className="relative z-50 flex items-center gap-3 bg-red-600 px-4 py-2.5 text-white shadow-lg">
      <AlertTriangle className="h-4 w-4 flex-none" />
      <p className="flex-1 text-sm font-medium">
        Your AWS session has expired — reconnect in{' '}
        <a href="/settings" className="font-bold underline underline-offset-2 hover:text-red-100">Settings</a>.
      </p>
      <button
        onClick={() => setDismissed(true)}
        title="Dismiss"
        className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/20 transition"
        aria-label="Dismiss banner"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

