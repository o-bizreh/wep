import { useState, useEffect, useCallback } from 'react';
import { UserCircle2, Key, Monitor } from 'lucide-react';
import { settingsApi, type AwsIdentity } from '../lib/api';

export function AwsIdentityBadge() {
  const [identity, setIdentity] = useState<AwsIdentity | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await settingsApi.getIdentity();
      setIdentity(data);
    } catch {
      setIdentity(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener('wep:credentials-changed', handler);
    return () => window.removeEventListener('wep:credentials-changed', handler);
  }, [load]);

  if (loading || !identity) return null;

  const isLocal = identity.principalType === 'local';
  const Icon = isLocal ? Monitor : identity.principalType === 'iam-user' ? UserCircle2 : Key;

  return (
    <div
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
      title={identity.arn}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-gray-500" />
      <span className="max-w-[140px] truncate font-medium text-gray-400">
        {identity.displayName}
      </span>
      {!isLocal && (
        <>
          <span className="text-gray-600">·</span>
          <span className="font-mono text-gray-500">
            {identity.accountAlias ?? identity.account}
          </span>
        </>
      )}
    </div>
  );
}

export function notifyCredentialsChanged() {
  window.dispatchEvent(new Event('wep:credentials-changed'));
}
