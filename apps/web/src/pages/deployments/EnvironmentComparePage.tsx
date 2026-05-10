import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@wep/ui';
import { clsx } from 'clsx';

interface ServiceDiff {
  serviceId: string;
  serviceName: string;
  stagingSha: string;
  productionSha: string;
  commitsBehind: number;
  daysBehind: number;
}

export function EnvironmentComparePage() {
  const [diffs, setDiffs] = useState<ServiceDiff[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    // Placeholder — will call the environment diff API
    setDiffs([]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const inSyncCount = diffs.filter((d) => d.commitsBehind === 0).length;
  const outOfSync = diffs.filter((d) => d.commitsBehind > 0);

  return (
    <div>
      <PageHeader title="Environment Comparison" onRefresh={fetchData} refreshing={loading} />
      <p className="text-sm text-gray-500 dark:text-gray-400 -mt-4 mb-6">Staging vs Production</p>

      {loading ? (
        <p className="text-center text-gray-500 dark:text-gray-400 py-8">Loading...</p>
      ) : diffs.length === 0 ? (
        <p className="text-center text-gray-500 dark:text-gray-400 py-8">No environment data available yet. Deploy some services to see comparisons.</p>
      ) : (
        <>
          {inSyncCount > 0 && (
            <p className="text-sm text-green-600 mb-4">{inSyncCount} services are in sync</p>
          )}
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Service</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Staging</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Production</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Behind</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {outOfSync.map((d) => (
                  <tr key={d.serviceId}>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{d.serviceName}</td>
                    <td className="px-6 py-4 text-sm font-mono text-gray-600 dark:text-gray-300">{d.stagingSha.slice(0, 7)}</td>
                    <td className="px-6 py-4 text-sm font-mono text-gray-600 dark:text-gray-300">{d.productionSha.slice(0, 7)}</td>
                    <td className={clsx('px-6 py-4 text-sm font-medium', {
                      'text-yellow-600': d.commitsBehind <= 5,
                      'text-orange-600': d.commitsBehind > 5 && d.commitsBehind <= 10,
                      'text-red-600': d.commitsBehind > 10,
                    })}>
                      {d.commitsBehind} commits
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{d.daysBehind}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
