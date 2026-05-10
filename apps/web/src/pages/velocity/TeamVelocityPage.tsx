import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { DORADashboardGrid, Spinner, PageHeader } from '@wep/ui';
import { velocityApi } from '../../lib/api';

interface MetricValue {
  value: number;
  classification: 'elite' | 'high' | 'medium' | 'low';
}

interface MetricSnapshot {
  deploymentFrequency: MetricValue;
  leadTimeForChanges: MetricValue;
  meanTimeToRecovery: MetricValue | null;
  changeFailureRate: MetricValue;
  sampleSize: number;
  periodIdentifier: string;
}

export function TeamVelocityPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const [current, setCurrent] = useState<MetricSnapshot | null>(null);
  const [history, setHistory] = useState<MetricSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    setError(null);
    velocityApi.getTeamMetrics(teamId, 5)
      .then((result) => {
        setCurrent(result.current as MetricSnapshot);
        setHistory(result.history as MetricSnapshot[]);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [teamId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;

  if (error) {
    return (
      <div>
        <PageHeader title="Team Velocity" onRefresh={fetchData} refreshing={loading} />
        <div className="text-center py-12">
          <p className="text-red-600 font-medium">{error}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">This may indicate the team is too small for standalone metrics.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Team Velocity" onRefresh={fetchData} refreshing={loading} />
      <p className="text-sm text-gray-500 dark:text-gray-400 -mt-4 mb-6">Team: {teamId}</p>

      {current ? (
        <DORADashboardGrid metrics={current} />
      ) : (
        <p className="text-gray-500 text-center py-8">No metrics data available for this team.</p>
      )}

      {history.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Weekly History</h2>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Period</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Deploy Freq</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Lead Time</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">CFR</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Sample</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {history.map((h) => (
                  <tr key={h.periodIdentifier}>
                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">{h.periodIdentifier}</td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{h.deploymentFrequency.value.toFixed(2)}/day</td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{h.leadTimeForChanges.value.toFixed(1)}h</td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{h.changeFailureRate.value.toFixed(1)}%</td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{h.sampleSize}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
