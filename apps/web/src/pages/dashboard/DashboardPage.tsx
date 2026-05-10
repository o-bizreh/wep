import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ExternalLink,
  Activity,
  Zap,
  Rocket,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ArrowUpRight,
  Clock,
  TrendingUp,
  BarChart3,
  Search,
  ChevronRight,
  ServerCog,
  Loader2,
} from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { clsx } from 'clsx';
import { fetchApi, errorsApi, type ErrorsCategory, type ErrorsCategoryResult } from '../../lib/api';

// --- Types ---
interface Alarm {
  name: string;
  state: string;
  namespace: string;
  metric: string;
  consoleUrl: string;
}

interface DegradedService {
  serviceId: string;
  serviceName: string;
  status: 'degraded' | 'unhealthy';
  signals: string[];
}

interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  createdAt: string;
  author: string;
}

interface HealthTrendPoint {
  date: string;
  healthPct: number;
  errors: number;
  requests: number;
}

interface DashboardTiles {
  staleServicesProdCount: number;
  staleServicesDevCount: number;
  runbooksCount: number;
  servicesTotal: number;
  degradedCount: number;
}

interface DashboardData {
  alarms: Alarm[];
  degradedServices: DegradedService[];
  tiles: DashboardTiles;
}

interface HealthTrendData {
  currentPct: number;
  deltaPct: number;
  trend: HealthTrendPoint[];
  resourceCounts: {
    lambdas: number;
    albs: number;
    firehose: number;
    sns: number;
    sqsDlqs: number;
    dynamodb: number;
    apigateway: number;
    stepfunctions: number;
  };
}

// --- UI Components for Bento ---

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  to?: string;          // internal route — wraps the card in a Link
}

function Card({ children, className, title, icon, action, to }: CardProps) {
  const baseClasses = clsx(
    'group relative flex flex-col rounded-3xl border border-slate-200/50 bg-white/60 dark:border-white/5 dark:bg-zinc-900/40 backdrop-blur-3xl shadow-xl shadow-slate-200/20 dark:shadow-black/60 overflow-hidden transition-all duration-500 hover:shadow-2xl hover:-translate-y-1',
    to && 'cursor-pointer hover:border-cyan-500/40 dark:hover:border-cyan-500/30',
    className,
  );

  const inner = (
    <>
      {(title || icon) && (
        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-slate-100 dark:bg-white/5 text-zinc-400 group-hover:text-cyan-500 transition-colors">
              {icon}
            </div>
            <h3 className="font-bold text-zinc-900 dark:text-white tracking-tight">{title}</h3>
          </div>
          {action}
        </div>
      )}
      <div className="flex-1 min-h-0">
        {children}
      </div>
    </>
  );

  if (to) {
    return <Link to={to} className={baseClasses}>{inner}</Link>;
  }
  return <div className={baseClasses}>{inner}</div>;
}

type ErrorTileState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: ErrorsCategoryResult };

interface ErrorMiniTileProps {
  state: ErrorTileState;
  label: string;
  icon: React.ReactNode;
  accent: 'rose' | 'amber';
}

function ErrorMiniTile({ state, label, icon, accent }: ErrorMiniTileProps) {
  const isLoading = state.status === 'loading';
  const isError = state.status === 'error';
  const data = state.status === 'ready' ? state.data : null;
  const total = data?.totalErrors ?? 0;
  const affected = data?.resources.length ?? 0;
  const series = data?.chart ?? [];
  const hasErrors = total > 0;

  // Tint the gradient by severity: errors → rose/amber, healthy → emerald.
  const stroke = !data ? '#71717a' : hasErrors ? (accent === 'rose' ? '#f43f5e' : '#f59e0b') : '#10b981';
  const gradId = `err-${label.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <Card to="/errors" className="md:col-span-1 md:row-span-1">
      <div className="p-5 h-full flex flex-col justify-between">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 text-zinc-400">
            {icon}
            <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
          </div>
          {isLoading ? (
            <Loader2 className="h-4 w-4 text-zinc-300 animate-spin" />
          ) : (
            <ArrowUpRight className="h-4 w-4 text-zinc-300" />
          )}
        </div>
        <div className="flex items-end justify-between gap-2 mt-2">
          <div>
            <p className={clsx(
              'text-3xl font-black tracking-tighter',
              isError ? 'text-zinc-400' : hasErrors ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-900 dark:text-white',
            )}>
              {isLoading ? '—' : isError ? '?' : total.toLocaleString()}
            </p>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">
              {isLoading ? 'Loading…' : isError ? 'Failed' : hasErrors ? `${affected} affected · 24h` : 'Healthy · 24h'}
            </p>
          </div>
          {!isLoading && !isError && series.length > 0 && (
            <div className="w-24 h-12 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series}>
                  <defs>
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"  stopColor={stroke} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="value" stroke={stroke} strokeWidth={1.5} fillOpacity={1} fill={`url(#${gradId})`} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [health, setHealth] = useState<HealthTrendData | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAnn, setSelectedAnn] = useState<Announcement | null>(null);
  type DashboardErrorTiles = { lambda: ErrorTileState; alb: ErrorTileState };
  const [errorTiles, setErrorTiles] = useState<DashboardErrorTiles>({
    lambda: { status: 'loading' },
    alb:    { status: 'loading' },
  });

  const loadErrorTile = useCallback((cat: keyof DashboardErrorTiles) => {
    setErrorTiles((prev) => ({ ...prev, [cat]: { status: 'loading' } }));
    errorsApi.getCategory(cat as ErrorsCategory, '24h')
      .then((res) => setErrorTiles((prev) => ({ ...prev, [cat]: { status: 'ready', data: res } })))
      .catch((err) => {
        console.error(`Errors ${cat} fetch failed:`, err);
        setErrorTiles((prev) => ({ ...prev, [cat]: { status: 'error' } }));
      });
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setHealthLoading(true);
    setHealth(null);

    // Fast path — render the page as soon as alarms + services land.
    void (async () => {
      try {
        const [dash, anns] = await Promise.all([
          fetchApi<DashboardData>('/dashboard'),
          fetchApi<Announcement[]>('/announcements').catch(() => []),
        ]);
        setData(dash);
        setAnnouncements(anns);
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    })();

    // Slow path — health trend. Independent of the rest.
    void (async () => {
      try {
        const trend = await fetchApi<HealthTrendData>('/dashboard/health-trend');
        setHealth(trend);
      } catch (error) {
        console.error('Failed to fetch health trend:', error);
      } finally {
        setHealthLoading(false);
      }
    })();

    // Lambda + ALB error tiles, lazy-loaded via the errors endpoint.
    loadErrorTile('lambda');
    loadErrorTile('alb');
  }, [loadErrorTile]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-10 w-48 bg-zinc-200 dark:bg-zinc-800 rounded-lg"></div>
        <div className="grid grid-cols-4 grid-rows-4 gap-6 h-[80vh]">
          <div className="col-span-2 row-span-2 bg-zinc-100 dark:bg-zinc-800/40 rounded-3xl"></div>
          <div className="col-span-1 row-span-2 bg-zinc-100 dark:bg-zinc-800/40 rounded-3xl"></div>
          <div className="col-span-1 row-span-1 bg-zinc-100 dark:bg-zinc-800/40 rounded-3xl"></div>
          <div className="col-span-1 row-span-1 bg-zinc-100 dark:bg-zinc-800/40 rounded-3xl"></div>
          <div className="col-span-2 row-span-2 bg-zinc-100 dark:bg-zinc-800/40 rounded-3xl"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10 pb-20">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-black text-zinc-900 dark:text-white tracking-tighter sm:text-5xl">
            System <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 to-blue-600">Pulse</span>
          </h1>
          <p className="mt-3 text-zinc-500 font-medium">Global platform diagnostic and operational metrics.</p>
        </div>
        <div className="flex items-center gap-3">
           <button 
             onClick={fetchData}
             className="p-2.5 rounded-xl border border-slate-200 hover:bg-white dark:border-white/5 dark:hover:bg-white/5 transition-all"
           >
             <Clock className="h-5 w-5 text-zinc-400" />
           </button>
        </div>
      </header>

      {/* THE BENTO GRID */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 auto-rows-[180px]">
        
        {/* 1. Global Platform Heat (2x2) */}
        {(() => {
          const ready = !!health;
          const currentPct = health?.currentPct ?? 0;
          const deltaPct = health?.deltaPct ?? 0;
          const trend = health?.trend ?? [];
          const isHealthy = currentPct >= 95;
          const isOk = currentPct >= 80;
          const badgeClasses = !ready
            ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-400 border-zinc-200 dark:border-zinc-800'
            : isHealthy
              ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
              : isOk
                ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                : 'bg-red-500/10 text-red-500 border-red-500/20';
          const badgeLabel = !ready ? 'Loading' : isHealthy ? 'All OK' : isOk ? 'Degraded' : 'At Risk';
          const deltaPositive = deltaPct >= 0;
          const [whole, frac = '0'] = currentPct.toFixed(1).split('.');
          const totalProdResources = health
            ? health.resourceCounts.lambdas
              + health.resourceCounts.albs
              + health.resourceCounts.firehose
              + health.resourceCounts.sns
              + health.resourceCounts.sqsDlqs
              + health.resourceCounts.dynamodb
              + health.resourceCounts.apigateway
              + health.resourceCounts.stepfunctions
            : 0;
          return (
            <Card
              title="Platform Health · Past 24 Hours"
              icon={<Activity className="h-5 w-5" />}
              className="md:col-span-2 md:row-span-2"
              to="/errors"
              action={
                <div className={clsx('flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border', badgeClasses)}>
                  <CheckCircle2 className="h-3 w-3" /> {badgeLabel}
                </div>
              }
            >
              <div className="h-full flex flex-col px-6 pb-6">
                {ready ? (
                  <>
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-5xl font-black text-zinc-900 dark:text-white tracking-tighter">
                        {whole}.{frac}<span className="text-2xl text-zinc-400">%</span>
                      </span>
                      <span className={clsx('text-sm font-bold flex items-center gap-1', deltaPositive ? 'text-emerald-500' : 'text-red-500')}>
                        <TrendingUp className={clsx('h-3 w-3', !deltaPositive && 'rotate-180')} />
                        {deltaPositive ? '+' : ''}{deltaPct.toFixed(1)}%
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest mb-3">
                      {trend.length > 0
                        ? `Past 24 hours · ${totalProdResources} production resources`
                        : 'No trend data'}
                    </p>
                    <div className="flex-1 w-full -mx-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={trend}>
                          <defs>
                            <linearGradient id="glowPulse" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="date" hide />
                          <YAxis domain={[0, 100]} hide />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#18181b', border: 'none', borderRadius: '12px', fontSize: '12px', color: '#fff' }}
                            itemStyle={{ color: '#22d3ee' }}
                            labelFormatter={(label) => {
                              // Bucket key is "yyyy-mm-ddTHH" — show as "Apr 29, 14:00"
                              const s = String(label ?? '');
                              if (s.length < 13) return s;
                              const d = new Date(`${s}:00:00Z`);
                              return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                            }}
                            formatter={(value, _name, item) => {
                              const p = (item as { payload?: HealthTrendPoint } | undefined)?.payload;
                              const errs = p?.errors ?? 0;
                              const reqs = p?.requests ?? 0;
                              return [`${value}% (${errs.toLocaleString()} errors / ${reqs.toLocaleString()} requests)`, 'Health'];
                            }}
                          />
                          <Area type="monotone" dataKey="healthPct" stroke="#06b6d4" strokeWidth={3} fillOpacity={1} fill="url(#glowPulse)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                ) : (
                  <div className="animate-pulse flex flex-col h-full">
                    <div className="h-12 w-40 bg-zinc-200 dark:bg-zinc-800 rounded-lg mb-2" />
                    <div className="h-3 w-24 bg-zinc-200 dark:bg-zinc-800 rounded mb-4" />
                    <div className="flex-1 bg-zinc-100 dark:bg-zinc-800/40 rounded-2xl flex items-center justify-center">
                      <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">
                        {healthLoading ? 'Computing 24-hour health…' : 'Trend unavailable'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          );
        })()}

        {/* 2. Critical Alarms (1x2) — each item links to its AWS console URL */}
        <Card
          title="Live Alarms"
          icon={<AlertCircle className="h-5 w-5" />}
          className="md:col-span-1 md:row-span-2"
        >
          <div className="px-2 space-y-1">
            {data?.alarms.map((alarm, i) => (
              <a
                key={alarm.name}
                href={alarm.consoleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={clsx(
                  'p-3 rounded-2xl flex items-center justify-between group/item cursor-pointer transition-all',
                  i === 0 ? 'bg-red-500/5 border border-red-500/10 hover:bg-red-500/10' : 'hover:bg-zinc-50 dark:hover:bg-white/5',
                )}
              >
                <div className="min-w-0">
                  <p className="font-bold text-sm text-zinc-800 dark:text-zinc-200 truncate">{alarm.name}</p>
                  <p className="text-[10px] text-zinc-500 font-mono uppercase truncate mt-0.5">{alarm.namespace}</p>
                </div>
                <div className={clsx(
                  'h-2 w-2 rounded-full shrink-0',
                  i === 0 ? 'bg-red-500 shadow-[0_0_8px_danger]' : 'bg-amber-500',
                )} />
              </a>
            ))}
            {(!data || data.alarms.length === 0) && (
              <div className="py-10 text-center text-zinc-400 text-xs italic">
                No active alarms
              </div>
            )}
          </div>
        </Card>

        {/* 3a. Stale Services — Production (1x1) */}
        <Card to="/catalog/stale?env=production" className="md:col-span-1 md:row-span-1 bg-gradient-to-br from-rose-500/5 to-transparent">
          <div className="p-6 h-full flex flex-col justify-between">
            <div className="flex justify-between items-start">
              <Search className="h-5 w-5 text-rose-500" />
              <ArrowUpRight className="h-4 w-4 text-zinc-300" />
            </div>
            <div>
              <p className="text-3xl font-black text-zinc-900 dark:text-white">
                {data ? data.tiles.staleServicesProdCount : '—'}
              </p>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mt-1">Stale · Prod</p>
            </div>
          </div>
        </Card>

        {/* 3b. Stale Services — Development (1x1) */}
        <Card to="/catalog/stale?env=development" className="md:col-span-1 md:row-span-1 bg-gradient-to-br from-amber-500/5 to-transparent">
          <div className="p-6 h-full flex flex-col justify-between">
            <div className="flex justify-between items-start">
              <Search className="h-5 w-5 text-amber-500" />
              <ArrowUpRight className="h-4 w-4 text-zinc-300" />
            </div>
            <div>
              <p className="text-3xl font-black text-zinc-900 dark:text-white">
                {data ? data.tiles.staleServicesDevCount : '—'}
              </p>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mt-1">Stale · Dev</p>
            </div>
          </div>
        </Card>

        {/* 4. Runbooks (1x1) */}
        <Card to="/portal/runbooks" className="md:col-span-1 md:row-span-1 bg-gradient-to-br from-cyan-500/5 to-transparent">
           <div className="p-6 h-full flex flex-col justify-between">
            <div className="flex justify-between items-start">
              <Zap className="h-5 w-5 text-cyan-500" />
              <div className="h-2 w-2 rounded-full bg-cyan-500 animate-pulse" />
            </div>
            <div>
              <p className="text-3xl font-black text-zinc-900 dark:text-white">
                {data ? data.tiles.runbooksCount : '—'}
              </p>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mt-1">Runbooks</p>
            </div>
          </div>
        </Card>

        {/* 5. Announcement Banner (2x1) */}
        <Card className="md:col-span-2 md:row-span-1 border-none shadow-none bg-transparent">
           <div className="relative h-full w-full rounded-3xl overflow-hidden bg-gradient-to-br from-indigo-600 to-violet-700 p-8 shadow-2xl shadow-indigo-500/20">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -mr-20 -mt-20" />
              <div className="relative z-10 h-full flex flex-col justify-between">
                <div>
                   <span className="px-2 py-0.5 rounded bg-white/20 text-[10px] font-black text-white uppercase tracking-widest border border-white/20">
                     Latest Update
                   </span>
                   <h4 className="mt-3 text-2xl font-bold text-white tracking-tight line-clamp-1">
                     {announcements[0]?.title || 'System Maintenance Notice'}
                   </h4>
                </div>
                <button 
                  onClick={() => announcements[0] && setSelectedAnn(announcements[0])}
                  className="flex w-fit items-center gap-2 text-white/80 hover:text-white text-sm font-bold transition-colors"
                >
                  Read Announcement <ChevronRight className="h-4 w-4" />
                </button>
              </div>
           </div>
        </Card>

        {/* 6. Velocity (1x1) — links to /velocity for live DORA metrics */}
        <Card to="/velocity" className="md:col-span-1 md:row-span-1">
           <div className="p-6 h-full flex flex-col justify-between">
            <div className="flex justify-between items-start">
              <BarChart3 className="h-5 w-5 text-indigo-500" />
              <ArrowUpRight className="h-4 w-4 text-zinc-300" />
            </div>
            <div>
              <p className="text-base font-bold text-zinc-900 dark:text-white tracking-tight">View metrics</p>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mt-1">DORA & Velocity</p>
            </div>
          </div>
        </Card>

        {/* 7. Deployments (1x1) — links to the live deployment feed */}
        <Card to="/deployments" className="md:col-span-1 md:row-span-1">
           <div className="p-6 h-full flex flex-col justify-between">
            <div className="flex justify-between items-start">
              <Rocket className="h-5 w-5 text-emerald-500" />
              <ArrowUpRight className="h-4 w-4 text-zinc-300" />
            </div>
            <div>
              <p className="text-base font-bold text-zinc-900 dark:text-white tracking-tight">View activity</p>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mt-1">Deployment Feed</p>
            </div>
          </div>
        </Card>

        {/* 8. Lambda Errors (1x1) — lazy-loaded via /errors/lambda */}
        <ErrorMiniTile
          state={errorTiles.lambda}
          label="Lambda Errors"
          icon={<ServerCog className="h-4 w-4" />}
          accent="rose"
        />

        {/* 9. ALB Errors (1x1) — lazy-loaded via /errors/alb */}
        <ErrorMiniTile
          state={errorTiles.alb}
          label="ALB 5xx"
          icon={<AlertTriangle className="h-4 w-4" />}
          accent="amber"
        />

      </div>

      {/* Tertiary: Degraded Services List (Full Width) */}
      <section>
        <div className="flex items-center justify-between mb-6 px-2">
           <h2 className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight">Degraded Services</h2>
           {data && data.degradedServices.length > 0 && (
             <span className="px-3 py-1 rounded-full bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 text-xs font-bold">
               Requires Action
             </span>
           )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {data?.degradedServices.map(svc => (
             <Link 
               key={svc.serviceId} 
               to={`/catalog/services/${svc.serviceId}`}
               className="flex items-center justify-between p-5 rounded-3xl border border-slate-200/50 bg-white dark:border-white/5 dark:bg-zinc-900/40 hover:scale-[1.02] transition-transform shadow-lg shadow-black/5"
             >
                <div className="flex items-center gap-4">
                   <div className="h-12 w-12 rounded-2xl bg-red-500/10 flex items-center justify-center text-red-500 shadow-[inset_0_0_12px_rgba(239,68,68,0.1)]">
                      <AlertCircle className="h-6 w-6" />
                   </div>
                   <div>
                      <p className="font-bold text-zinc-900 dark:text-white tracking-tight">{svc.serviceName}</p>
                      <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">{svc.signals[0]}</p>
                   </div>
                </div>
                <ChevronRight className="h-5 w-5 text-zinc-300" />
             </Link>
          ))}
          {(!data || data.degradedServices.length === 0) && (
            <div className="col-span-full py-12 text-center border-2 border-dashed border-slate-100 dark:border-white/5 rounded-3xl">
               <p className="text-zinc-400 font-medium">No services require immediate attention.</p>
            </div>
          )}
        </div>
      </section>

      {/* ANNOUNCEMENT MODAL */}
      {selectedAnn && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm animate-in fade-in" 
            onClick={() => setSelectedAnn(null)} 
          />
          <div className="relative w-full max-w-2xl rounded-[40px] border border-white/20 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-3xl shadow-2xl p-8 lg:p-12 animate-in zoom-in-95 duration-200">
            <button 
               onClick={() => setSelectedAnn(null)}
               className="absolute top-8 right-8 p-2 rounded-full bg-zinc-100 dark:bg-white/5 text-zinc-400 hover:text-zinc-600 dark:hover:text-white transition-colors"
            >
               <Zap className="h-5 w-5 rotate-45" />
            </button>

            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <span className={clsx(
                  "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                  selectedAnn.severity === 'critical' ? "bg-red-500 text-white" : "bg-cyan-500 text-white"
                )}>
                  {selectedAnn.severity}
                </span>
                <span className="text-sm font-bold text-zinc-400">
                  {new Date(selectedAnn.createdAt).toLocaleDateString()}
                </span>
              </div>
              
              <h2 className="text-4xl lg:text-5xl font-black text-zinc-900 dark:text-white tracking-tighter leading-none">
                {selectedAnn.title}
              </h2>
              
              <div className="w-20 h-1.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-full" />
              
              <div className="prose prose-zinc dark:prose-invert max-w-none">
                <p className="text-lg lg:text-xl text-zinc-600 dark:text-zinc-400 leading-relaxed font-medium">
                  {selectedAnn.body}
                </p>
              </div>

              <div className="flex items-center gap-4 pt-8 border-t border-zinc-100 dark:border-white/5">
                <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-xl font-black shadow-lg shadow-cyan-500/20">
                  {selectedAnn.author.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-bold text-zinc-900 dark:text-white tracking-tight">{selectedAnn.author}</p>
                  <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Platform Engineering</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
