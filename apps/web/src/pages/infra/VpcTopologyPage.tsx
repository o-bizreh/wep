import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@wep/ui';
import { Network, Shield, ChevronDown, Loader2, ArrowDown, ArrowUp, RefreshCw } from 'lucide-react';
import { infraApi } from '../../lib/api';
import { cacheGet, cacheSet, cacheClear } from '../../lib/cache';

type TopologyData = Awaited<ReturnType<typeof infraApi.getTopology>>;
type Vpc           = TopologyData['vpcs'][number];
type Subnet        = TopologyData['subnets'][number];
type SecurityGroup = TopologyData['securityGroups'][number];
type SgRule        = SecurityGroup['ingressRules'][number];

const CACHE_KEY = 'infra-topology';

function RuleLine({ r }: { r: SgRule & { cidrs: string[] } }) {
  const portLabel = r.protocol === '-1' ? 'All'
    : r.fromPort === r.toPort ? `${r.protocol.toUpperCase()} ${r.fromPort ?? '*'}`
    : `${r.protocol.toUpperCase()} ${r.fromPort ?? '*'}-${r.toPort ?? '*'}`;
  const sources = [...r.cidrs, ...((r as { sourceSgs?: string[] }).sourceSgs ?? [])];
  return (
    <div className="flex items-start gap-1.5 text-xs">
      <span className="shrink-0 rounded bg-gray-100 dark:bg-zinc-700 px-1.5 py-0.5 font-mono text-gray-600 dark:text-gray-300">{portLabel}</span>
      <div className="flex flex-wrap gap-1">
        {sources.length === 0 ? <span className="text-gray-400">—</span> : sources.map((s) => (
          <span key={s} className={`rounded px-1.5 py-0.5 font-mono ${s === '0.0.0.0/0' || s === '::/0' ? 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400' : 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400'}`}>{s}</span>
        ))}
      </div>
    </div>
  );
}

function SgCard({ sg }: { sg: SecurityGroup }) {
  const [open, setOpen] = useState(false);
  const hasOpenIngress = sg.ingressRules.some((r) => r.cidrs.includes('0.0.0.0/0') || r.cidrs.includes('::/0'));

  return (
    <div className="rounded-xl border border-gray-100 dark:border-white/10 bg-gray-50/50 dark:bg-zinc-800/50 overflow-hidden">
      <button onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors text-left">
        <div className="flex items-center gap-2 min-w-0">
          <Shield className={`h-4 w-4 shrink-0 ${hasOpenIngress ? 'text-amber-400' : 'text-gray-400'}`} />
          <span className="font-mono text-xs font-medium text-gray-900 dark:text-white truncate">{sg.name}</span>
          <span className="text-xs text-gray-400 shrink-0 hidden sm:inline">{sg.groupId}</span>
          {hasOpenIngress && <span className="rounded-full bg-amber-100 dark:bg-amber-950/30 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400 shrink-0">Open ingress</span>}
        </div>
        <ChevronDown className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-gray-100 dark:border-white/10">
          {sg.description && <p className="px-4 pt-3 text-xs text-gray-400">{sg.description}</p>}
          {/* Side-by-side ingress / egress */}
          <div className="grid grid-cols-2 gap-0 divide-x divide-gray-100 dark:divide-white/10 px-0">
            <div className="px-4 py-3">
              <div className="flex items-center gap-1.5 mb-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <ArrowDown className="h-3 w-3" /> Ingress
              </div>
              <div className="space-y-1.5">
                {sg.ingressRules.length === 0
                  ? <span className="text-xs text-gray-400">None</span>
                  : sg.ingressRules.map((r, i) => <RuleLine key={i} r={r as SgRule & { cidrs: string[] }} />)}
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="flex items-center gap-1.5 mb-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <ArrowUp className="h-3 w-3" /> Egress
              </div>
              <div className="space-y-1.5">
                {sg.egressRules.length === 0
                  ? <span className="text-xs text-gray-400">None</span>
                  : sg.egressRules.map((r, i) => <RuleLine key={i} r={r as SgRule & { cidrs: string[] }} />)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function VpcBlock({ vpc, subnets, sgs }: { vpc: Vpc; subnets: Subnet[]; sgs: SecurityGroup[] }) {
  const [open, setOpen] = useState(true);
  const publicSubnets  = subnets.filter((s) => s.isPublic);
  const privateSubnets = subnets.filter((s) => !s.isPublic);

  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white dark:border-white/10 dark:bg-zinc-900/40 shadow-xl shadow-slate-200/20 dark:shadow-black/40 overflow-hidden">
      <button onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          <Network className="h-5 w-5 text-cyan-500 shrink-0" />
          <div className="text-left min-w-0">
            <p className="font-semibold text-gray-900 dark:text-white truncate">{vpc.name ?? vpc.vpcId}</p>
            <p className="text-xs text-gray-400 font-mono mt-0.5">{vpc.vpcId} · {vpc.cidr}</p>
          </div>
          {vpc.isDefault && <span className="rounded-full bg-gray-100 dark:bg-zinc-800 px-2 py-0.5 text-xs text-gray-500 shrink-0">default</span>}
          <span className="text-xs text-gray-400 shrink-0 hidden sm:inline">{subnets.length} subnets · {sgs.length} SGs</span>
        </div>
        <ChevronDown className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-gray-100 dark:border-white/10 px-5 py-4 space-y-5">
          {subnets.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Subnets</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {([['Public', publicSubnets, 'emerald'], ['Private', privateSubnets, 'violet']] as const).map(([label, list, color]) =>
                  list.length > 0 ? (
                    <div key={label}>
                      <p className={`text-xs font-semibold mb-2 text-${color}-600 dark:text-${color}-400`}>{label} ({list.length})</p>
                      <div className="space-y-1.5">
                        {list.map((s) => (
                          <div key={s.subnetId} className="flex items-center justify-between rounded-lg border border-gray-100 dark:border-white/10 bg-gray-50 dark:bg-zinc-800/50 px-3 py-2">
                            <div>
                              <p className="font-mono text-xs text-gray-700 dark:text-gray-300">{s.name ?? s.subnetId}</p>
                              <p className="text-xs text-gray-400 font-mono mt-0.5">{s.cidr} · {s.az}</p>
                            </div>
                            <span className="text-xs text-gray-400 shrink-0 ml-2">{s.availableIps} IPs</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null
                )}
              </div>
            </div>
          )}

          {sgs.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Security Groups</p>
              <div className="space-y-2">
                {sgs.map((sg) => <SgCard key={sg.groupId} sg={sg} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function VpcTopologyPage() {
  const [data, setData] = useState<TopologyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (bust = false) => {
    if (!bust) {
      const cached = cacheGet<TopologyData>(CACHE_KEY);
      if (cached) { setData(cached); setLoading(false); return; }
    } else {
      cacheClear(CACHE_KEY);
    }
    setError(null);
    try {
      const d = await infraApi.getTopology();
      cacheSet(CACHE_KEY, d);
      setData(d);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleRefresh = () => { setRefreshing(true); void load(true); };

  return (
    <div className="space-y-6">
      <PageHeader
        title="VPC Topology"
        actions={
          <button onClick={handleRefresh} disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50 transition-colors">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />
      <p className="text-sm text-gray-500 dark:text-gray-400">
        VPCs, subnets, and security group rules. Cached for 24 hours. Amber shield = open ingress to 0.0.0.0/0.
      </p>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>
      ) : error ? (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'VPCs',            value: data.vpcs.length },
              { label: 'Subnets',         value: data.subnets.length },
              { label: 'Security Groups', value: data.securityGroups.length },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-2xl border border-slate-200/60 bg-white dark:border-white/10 dark:bg-zinc-900/40 px-5 py-4 shadow-xl shadow-slate-200/20 dark:shadow-black/40">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">{label}</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            {data.vpcs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 py-12 text-center text-sm text-gray-400">
                No VPCs found. Verify your AWS credentials and region.
              </div>
            ) : data.vpcs.map((vpc) => (
              <VpcBlock key={vpc.vpcId} vpc={vpc}
                subnets={data.subnets.filter((s) => s.vpcId === vpc.vpcId)}
                sgs={data.securityGroups.filter((sg) => sg.vpcId === vpc.vpcId)} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
