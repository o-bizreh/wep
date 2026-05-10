import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { DataTable, StatusIndicator, Badge, Spinner, PageHeader, type Column } from '@wep/ui';
import { catalogApi } from '../../lib/api';

interface Team {
  teamId: string;
  teamName: string;
  domain: string;
  members: Array<{ userId: string; role: string }>;
}

interface Service {
  serviceId: string;
  serviceName: string;
  runtimeType: string;
  healthStatus: { status: string };
  environments: string[];
}

const columns: Column<Service>[] = [
  { key: 'name', header: 'Service', render: (s) => <span className="font-medium">{s.serviceName}</span> },
  { key: 'runtime', header: 'Runtime', render: (s) => <Badge variant="runtime" value={s.runtimeType} /> },
  { key: 'health', header: 'Health', render: (s) => <StatusIndicator status={s.healthStatus.status} /> },
];

export function TeamDashboardPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const [team, setTeam] = useState<Team | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    Promise.all([
      catalogApi.getTeam(teamId),
      catalogApi.getTeamServices(teamId),
    ])
      .then(([t, s]) => {
        setTeam(t as Team);
        setServices((s as { items: Service[] }).items);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [teamId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;
  if (!team) return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Team not found</div>;

  return (
    <div>
      <PageHeader title={team.teamName} onRefresh={fetchData} refreshing={loading} />
      <p className="text-sm text-gray-500 dark:text-gray-400 -mt-4 mb-6">{team.domain} &middot; {team.members.length} members</p>
      <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Owned Services</h2>
      <DataTable
        columns={columns}
        data={services}
        keyExtractor={(s) => s.serviceId}
        getRowHref={(s) => `/catalog/services/${s.serviceId}`}
        emptyMessage="No services owned by this team"
      />
    </div>
  );
}
