import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { DeploymentCard, Spinner, PageHeader } from '@wep/ui';
import { deploymentApi } from '../../lib/api';

interface Deployment {
  deploymentId: string;
  serviceId: string;
  environment: string;
  sha: string;
  actor: string;
  status: string;
  startedAt: string;
  durationSeconds: number | null;
}

export function ServiceDeploymentHistoryPage() {
  const { serviceId } = useParams<{ serviceId: string }>();
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!serviceId) return;
    setLoading(true);
    deploymentApi.getHistory(serviceId)
      .then((result) => setDeployments((result as { items: Deployment[] }).items))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [serviceId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;

  return (
    <div>
      <PageHeader title="Deployment History" onRefresh={fetchData} refreshing={loading} />
      <p className="text-sm text-gray-500 dark:text-gray-400 -mt-4 mb-6">Service: {serviceId}</p>
      <div className="space-y-3">
        {deployments.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 py-8">No deployments recorded for this service</p>
        ) : (
          deployments.map((d) => (
            <DeploymentCard
              key={d.deploymentId}
              serviceName={d.serviceId}
              environment={d.environment}
              sha={d.sha}
              actor={d.actor}
              status={d.status}
              timestamp={d.startedAt}
              durationSeconds={d.durationSeconds ?? undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}
