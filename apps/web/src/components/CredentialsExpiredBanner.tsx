import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, X, RefreshCw } from 'lucide-react';
import { settingsApi } from '../lib/api';
import { settings } from '../lib/settings';

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // re-validate every 10 min

export function CredentialsExpiredBanner() {
  const [expired, setExpired] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    // Only bother if the user has pasted SSO creds — IAM roles don't expire.
    if (!settings.hasAwsCredentials()) {
      setExpired(false);
      return;
    }
    try {
      const result = await settingsApi.validateCredentials();
      setExpired(result.expired);
      // If newly expired reset dismiss so the banner reappears.
      if (result.expired) setDismissed(false);
    } catch {
      // Network error — don't falsely flag as expired.
    }
  }, []);

  // Check on mount and on a recurring interval.
  useEffect(() => {
    void check();
    const id = setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [check]);

  // Re-check whenever credentials change (e.g. user pastes new ones in Settings).
  useEffect(() => {
    const handler = () => {
      setDismissed(false);
      void check();
    };
    window.addEventListener('wep:credentials-changed', handler);
    return () => window.removeEventListener('wep:credentials-changed', handler);
  }, [check]);

  async function recheck() {
    setChecking(true);
    await check();
    setChecking(false);
  }

  if (!expired || dismissed) return null;

  return (
    <div className="relative z-50 flex items-center gap-3 bg-red-600 px-4 py-2.5 text-white shadow-lg">
      <AlertTriangle className="h-4 w-4 flex-none" />
      <p className="flex-1 text-sm font-medium">
        Your AWS session credentials have expired.{' '}
        <Link
          to="/settings"
          className="font-bold underline underline-offset-2 hover:text-red-100 transition-colors"
        >
          Go to Settings
        </Link>{' '}
        to paste fresh SSO keys.
      </p>
      <button
        onClick={recheck}
        disabled={checking}
        title="Re-check credentials"
        className="flex items-center gap-1 rounded-md border border-white/30 bg-white/10 px-2 py-1 text-xs font-semibold hover:bg-white/20 transition disabled:opacity-50"
      >
        <RefreshCw className={`h-3 w-3 ${checking ? 'animate-spin' : ''}`} />
        Re-check
      </button>
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
