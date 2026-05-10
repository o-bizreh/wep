import { useState, useEffect } from 'react';
import { PageHeader } from '@wep/ui';
import { Loader2, GitBranch, ShieldAlert, ExternalLink } from 'lucide-react';
import { fetchApi, aiApi } from '../../lib/api';
import { OutputCard, RunBtn, FormCard } from './shared';

interface MonitoredRepo {
  owner: string;
  name: string;
  fullName: string;
  lastScanStatus: 'pending' | 'scanning' | 'done' | 'failed';
  packageCount: number;
}

interface VulnPackage {
  ecosystem: string;
  name: string;
  sources: string[];
  versions: string[];
  totalCves: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  exploitedCount: number;
}

interface CveEntry {
  cveId: string;
  summary: string;
  severity: string;
  cvssScore: number | null;
  isKevExploited: boolean;
}

type Phase = 'idle' | 'gathering' | 'analyzing' | 'done';

export function CveTriagePage() {
  const [repos, setRepos] = useState<MonitoredRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);

  useEffect(() => {
    void fetchApi<MonitoredRepo[]>('/security/repos')
      .then((data) => setRepos(data.filter((r) => r.lastScanStatus === 'done' && r.packageCount > 0)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load repos'))
      .finally(() => setLoadingRepos(false));
  }, []);

  async function run() {
    if (!selectedRepo) return;
    const [owner, name] = selectedRepo.split('/');
    setError(null);
    setOutput(null);
    setPhase('gathering');

    try {
      // Fetch all vulnerable packages for this repo
      const packages = await fetchApi<VulnPackage[]>('/security/vulnerabilities');
      const repoPackages = packages.filter((p) => p.sources.includes(`${owner}/${name}`));

      if (repoPackages.length === 0) {
        setOutput('No vulnerabilities found for this repository.');
        setPhase('done');
        return;
      }

      // Fetch CVE details for top packages (cap at 8 to stay within token budget)
      const top = repoPackages
        .sort((a, b) => (b.criticalCount * 4 + b.highCount * 2 + b.exploitedCount * 10) - (a.criticalCount * 4 + a.highCount * 2 + a.exploitedCount * 10))
        .slice(0, 8);

      const cvesByPackage: Record<string, CveEntry[]> = {};
      await Promise.all(
        top.map(async (pkg) => {
          try {
            const d = await fetchApi<{ cves: CveEntry[] }>(`/security/vulnerabilities/${pkg.ecosystem}/${encodeURIComponent(pkg.name)}`);
            cvesByPackage[pkg.name] = d.cves.slice(0, 10);
          } catch { cvesByPackage[pkg.name] = []; }
        }),
      );

      setPhase('analyzing');

      const payload = top.map((pkg) => ({
        package: pkg.name,
        ecosystem: pkg.ecosystem,
        versions: pkg.versions,
        critical: pkg.criticalCount,
        high: pkg.highCount,
        medium: pkg.mediumCount,
        low: pkg.lowCount,
        exploited: pkg.exploitedCount,
        cves: cvesByPackage[pkg.name] ?? [],
      }));

      const result = await aiApi.cveTriage(`${owner}/${name}`, payload as unknown[], []);
      setOutput(result.triage);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Triage failed');
      setPhase('idle');
    }
  }

  const loading = phase !== 'idle' && phase !== 'done';
  const phaseLabel = phase === 'gathering' ? 'Gathering CVE data…' : phase === 'analyzing' ? 'Analyzing with AI…' : '';

  return (
    <div className="space-y-6">
      <PageHeader title="CVE Triage Assistant" />
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Choose a tracked repository and get a prioritised CVE triage report — which vulnerabilities to tackle first and why.
      </p>

      <FormCard>
        {loadingRepos ? (
          <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading repositories…</div>
        ) : repos.length === 0 ? (
          <div className="rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 space-y-2">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">No scanned repositories found</p>
            <p className="text-xs text-amber-600 dark:text-amber-500">
              Go to <a href="/security/repos" className="underline font-medium">Security → Repositories</a>, add your repos and run a scan, then come back here.
            </p>
            <a href="/security/repos" className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline">
              <ExternalLink className="h-3.5 w-3.5" /> Go to Security Repositories
            </a>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">Select repository</label>
              <div className="max-h-56 overflow-y-auto space-y-1 border border-gray-100 dark:border-gray-800 rounded-lg p-2">
                {repos.map((repo) => {
                  const key = `${repo.owner}/${repo.name}`;
                  const isSelected = selectedRepo === key;
                  return (
                    <button key={key} onClick={() => setSelectedRepo(isSelected ? null : key)}
                      className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${isSelected ? 'bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-400' : 'hover:bg-gray-50 dark:hover:bg-zinc-800 border border-transparent'}`}>
                      <GitBranch className="h-4 w-4 text-indigo-400 shrink-0" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-gray-900 dark:text-white truncate">{repo.fullName}</span>
                        <span className="block text-xs text-gray-400">{repo.packageCount} packages tracked</span>
                      </span>
                      {(repo.packageCount > 0) && (
                        <span className="flex items-center gap-1 text-xs text-rose-500 dark:text-rose-400 shrink-0">
                          <ShieldAlert className="h-3.5 w-3.5" /> {repo.packageCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <RunBtn loading={loading} disabled={!selectedRepo || loading} onClick={() => { void run(); }} label="Triage CVEs" />
              {loading && <span className="text-xs text-indigo-500 dark:text-indigo-400 animate-pulse">{phaseLabel}</span>}
            </div>
          </>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}
      </FormCard>

      {output && <OutputCard output={output} onClear={() => { setOutput(null); setPhase('idle'); }} />}
    </div>
  );
}
