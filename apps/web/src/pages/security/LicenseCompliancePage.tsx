import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, AlertTriangle, Upload, ChevronDown, ChevronRight,
  Package, X, Filter,
} from 'lucide-react';
import { fetchApi } from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type RiskLevel = 'safe' | 'notice' | 'warning' | 'critical';

interface LicenseEntry {
  package: string;
  name: string;
  version: string;
  license: string;
  riskLevel: RiskLevel;
  repository?: string;
  publisher?: string;
}

interface ServiceMeta {
  serviceName: string;
  scannedAt: string;
  packageCount: number;
  criticalCount: number;
  warningCount: number;
  noticeCount: number;
  safeCount: number;
}

interface ServiceDetail extends ServiceMeta {
  licenses: LicenseEntry[];
}

interface RiskyPackageSummary {
  package: string;
  license: string;
  riskLevel: RiskLevel;
  servicesAffected: number;
  services: string[];
}

interface SummaryResponse {
  totalPackages: number;
  criticalCount: number;
  warningCount: number;
  servicesScanned: number;
  servicesWithCritical: string[];
  topRiskyPackages: RiskyPackageSummary[];
}

// ─── Risk Styling ─────────────────────────────────────────────────────────────

const RISK_BADGE: Record<RiskLevel, string> = {
  safe:     'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-900/20 dark:text-emerald-400',
  notice:   'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-900/20 dark:text-blue-400',
  warning:  'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-900/20 dark:text-amber-400',
  critical: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-900/20 dark:text-red-400',
};

const RISK_DOT: Record<RiskLevel, string> = {
  safe:     'bg-emerald-500',
  notice:   'bg-blue-500',
  warning:  'bg-amber-500',
  critical: 'bg-red-500',
};

const RISK_ORDER: Record<RiskLevel, number> = { critical: 0, warning: 1, notice: 2, safe: 3 };

function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset capitalize ${RISK_BADGE[level]}`}>
      {level}
    </span>
  );
}

function RiskBar({ critical, warning, notice, safe, total }: {
  critical: number; warning: number; notice: number; safe: number; total: number;
}) {
  if (total === 0) return <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-700" />;
  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-700">
      {critical > 0 && <div className="bg-red-500" style={{ width: pct(critical) }} title={`Critical: ${critical}`} />}
      {warning > 0  && <div className="bg-amber-400" style={{ width: pct(warning) }} title={`Warning: ${warning}`} />}
      {notice > 0   && <div className="bg-blue-400" style={{ width: pct(notice) }} title={`Notice: ${notice}`} />}
      {safe > 0     && <div className="bg-emerald-400" style={{ width: pct(safe) }} title={`Safe: ${safe}`} />}
    </div>
  );
}

// ─── Upload Modal ─────────────────────────────────────────────────────────────

function UploadScanModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [serviceName, setServiceName] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!serviceName.trim()) { setError('Service name is required'); return; }
    if (!jsonText.trim()) { setError('JSON payload is required'); return; }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      setError('Invalid JSON — please paste valid JSON');
      return;
    }

    // Accept either { packages: [...] } or a raw array
    let packages: unknown[];
    if (Array.isArray(parsed)) {
      packages = parsed;
    } else if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Record<string, unknown>)['packages'])) {
      packages = (parsed as Record<string, unknown>)['packages'] as unknown[];
    } else {
      setError('Expected { packages: [...] } or a raw array of package objects');
      return;
    }

    setSubmitting(true);
    try {
      await fetchApi(`/licenses/services/${encodeURIComponent(serviceName.trim())}/scan`, {
        method: 'POST',
        body: JSON.stringify({ packages }),
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl border border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
          <h2 className="text-lg font-black text-zinc-900 dark:text-white">Upload License Scan</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"><X className="h-5 w-5" /></button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Service Name</label>
            <input
              type="text"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              placeholder="e.g. laundry-api"
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              License Checker JSON
            </label>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
              Paste output from <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 rounded">license-checker --json</code> or an array of <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 rounded">{"{ name, version, license }"}</code> objects.
            </p>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={8}
              placeholder={'[{ "name": "lodash", "version": "4.17.21", "license": "MIT" }]'}
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-xs font-mono text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />{error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
          >
            {submitting ? 'Uploading…' : 'Upload Scan'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Service Row with Expandable Panel ────────────────────────────────────────

function ServiceRow({ service }: { service: ServiceMeta }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<ServiceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [riskFilter, setRiskFilter] = useState<RiskLevel | 'all'>('all');

  const loadDetail = useCallback(async () => {
    if (detail) return;
    setLoading(true);
    try {
      const data = await fetchApi<ServiceDetail>(`/licenses/services/${encodeURIComponent(service.serviceName)}`);
      setDetail(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [detail, service.serviceName]);

  const handleToggle = () => {
    if (!expanded) loadDetail();
    setExpanded((e) => !e);
  };

  const filteredLicenses = detail?.licenses
    .filter((l) => riskFilter === 'all' || l.riskLevel === riskFilter)
    .sort((a, b) => RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel]) ?? [];

  const relativeTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors border-b border-zinc-100 dark:border-zinc-800"
        onClick={handleToggle}
      >
        <td className="px-4 py-3 text-sm font-medium text-zinc-900 dark:text-white flex items-center gap-2">
          {expanded ? <ChevronDown className="h-4 w-4 text-zinc-400" /> : <ChevronRight className="h-4 w-4 text-zinc-400" />}
          {service.serviceName}
        </td>
        <td className="px-4 py-3 text-sm text-zinc-500 dark:text-zinc-400">{relativeTime(service.scannedAt)}</td>
        <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300 text-right">{service.packageCount.toLocaleString()}</td>
        <td className="px-4 py-3 text-sm text-right">
          {service.criticalCount > 0
            ? <span className="font-semibold text-red-600 dark:text-red-400">{service.criticalCount}</span>
            : <span className="text-zinc-400">0</span>}
        </td>
        <td className="px-4 py-3 text-sm text-right">
          {service.warningCount > 0
            ? <span className="font-semibold text-amber-600 dark:text-amber-400">{service.warningCount}</span>
            : <span className="text-zinc-400">0</span>}
        </td>
        <td className="px-4 py-3 text-sm text-right text-blue-600 dark:text-blue-400">{service.noticeCount}</td>
        <td className="px-4 py-3 text-sm text-right text-emerald-600 dark:text-emerald-400">{service.safeCount}</td>
        <td className="px-4 py-3 w-32">
          <RiskBar
            critical={service.criticalCount}
            warning={service.warningCount}
            notice={service.noticeCount}
            safe={service.safeCount}
            total={service.packageCount}
          />
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-zinc-100 dark:border-zinc-800">
          <td colSpan={8} className="px-4 py-4 bg-zinc-50 dark:bg-zinc-800/30">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
                Loading packages…
              </div>
            ) : detail ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-zinc-400" />
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Filter by risk:</span>
                  {(['all', 'critical', 'warning', 'notice', 'safe'] as const).map((level) => (
                    <button
                      key={level}
                      onClick={(e) => { e.stopPropagation(); setRiskFilter(level); }}
                      className={`rounded px-2 py-0.5 text-xs font-medium transition-colors capitalize ${
                        riskFilter === level
                          ? 'bg-indigo-600 text-white'
                          : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
                <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-100 dark:bg-zinc-700/50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">Package</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">Version</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">License</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">Risk</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700/50 bg-white dark:bg-zinc-800/20">
                      {filteredLicenses.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-3 py-4 text-center text-xs text-zinc-400">No packages match this filter.</td>
                        </tr>
                      ) : filteredLicenses.map((entry) => (
                        <tr key={entry.package} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                          <td className="px-3 py-2 font-mono text-xs text-zinc-800 dark:text-zinc-200">{entry.name}</td>
                          <td className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">{entry.version}</td>
                          <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300 font-mono">{entry.license}</td>
                          <td className="px-3 py-2"><RiskBadge level={entry.riskLevel} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-sm text-zinc-400">Failed to load packages.</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function LicenseCompliancePage() {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [services, setServices] = useState<ServiceMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryData, servicesData] = await Promise.all([
        fetchApi<SummaryResponse>('/licenses/summary'),
        fetchApi<ServiceMeta[]>('/licenses/services'),
      ]);
      setSummary(summaryData);
      setServices(servicesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load license data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const hasCritical = (summary?.criticalCount ?? 0) > 0;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-zinc-900 dark:text-white">License Compliance</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Track open-source licenses across your services and flag legal risk.</p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          <Upload className="h-4 w-4" />
          Upload Scan
        </button>
      </div>

      {/* Summary Bar */}
      {summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-5">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-4 w-4 text-zinc-500" />
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Total Packages</span>
            </div>
            <p className="text-3xl font-black text-zinc-900 dark:text-white">{summary.totalPackages.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-red-200 dark:border-red-900/50 p-5">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <span className="text-xs font-medium text-red-500 uppercase tracking-wider">Critical Risk</span>
            </div>
            <p className="text-3xl font-black text-red-600 dark:text-red-400">{summary.criticalCount.toLocaleString()}</p>
            <p className="text-xs text-zinc-400 mt-1">GPL/AGPL · requires source disclosure</p>
          </div>
          <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-900/50 p-5">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="h-4 w-4 text-amber-500" />
              <span className="text-xs font-medium text-amber-500 uppercase tracking-wider">Warning</span>
            </div>
            <p className="text-3xl font-black text-amber-600 dark:text-amber-400">{summary.warningCount.toLocaleString()}</p>
            <p className="text-xs text-zinc-400 mt-1">LGPL/unknown · review required</p>
          </div>
          <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-teal-200 dark:border-teal-900/50 p-5">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="h-4 w-4 text-teal-500" />
              <span className="text-xs font-medium text-teal-500 uppercase tracking-wider">Services Scanned</span>
            </div>
            <p className="text-3xl font-black text-teal-600 dark:text-teal-400">{summary.servicesScanned.toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Risk Legend */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 px-4 py-3">
        <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Risk Legend</span>
        {(['safe', 'notice', 'warning', 'critical'] as RiskLevel[]).map((level) => (
          <div key={level} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${RISK_DOT[level]}`} />
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300 capitalize">{level}</span>
            <span className="text-xs text-zinc-400">
              {level === 'safe'     && '(MIT, Apache, BSD…)'}
              {level === 'notice'   && '(MPL, EPL…)'}
              {level === 'warning'  && '(LGPL, unknown…)'}
              {level === 'critical' && '(GPL, AGPL — copyleft)'}
            </span>
          </div>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-indigo-600" />
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {!loading && !error && services.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 p-12 text-center">
          <ShieldCheck className="mx-auto h-12 w-12 text-zinc-300 dark:text-zinc-600 mb-3" />
          <h3 className="text-base font-bold text-zinc-700 dark:text-zinc-300 mb-1">No scans yet</h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4 max-w-md mx-auto">
            Upload your first license scan to start tracking open-source legal risk across your services.
            Run <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 rounded text-xs">license-checker --json</code> in your project and paste the output here.
          </p>
          <button
            onClick={() => setShowUpload(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
          >
            <Upload className="h-4 w-4" />
            Upload First Scan
          </button>
        </div>
      )}

      {/* Critical Packages Panel */}
      {hasCritical && summary && (
        <div className="rounded-2xl border-l-4 border-red-500 border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10 p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
            <h2 className="text-base font-black text-red-700 dark:text-red-400">
              Critical License Risk — {summary.criticalCount} package{summary.criticalCount !== 1 ? 's' : ''} require attention
            </h2>
          </div>
          <p className="text-sm text-red-600 dark:text-red-400 mb-4">
            These GPL/AGPL-licensed packages may require you to open-source your own code. Review with your legal team before shipping.
          </p>
          <div className="space-y-2">
            {summary.topRiskyPackages
              .filter((p) => p.riskLevel === 'critical')
              .map((pkg) => (
                <div key={pkg.package} className="flex items-start justify-between gap-4 rounded-lg bg-white dark:bg-zinc-900/50 border border-red-200 dark:border-red-800/50 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold font-mono text-zinc-900 dark:text-white truncate">{pkg.package}</p>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{pkg.license}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {pkg.servicesAffected} service{pkg.servicesAffected !== 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-zinc-400 truncate max-w-48">{pkg.services.slice(0, 3).join(', ')}{pkg.services.length > 3 ? '…' : ''}</p>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Services Table */}
      {!loading && services.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-700">
            <h2 className="text-base font-black text-zinc-900 dark:text-white">Services</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">Click a row to see all packages for that service.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Service</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Last Scanned</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Packages</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-red-500 uppercase tracking-wider">Critical</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-amber-500 uppercase tracking-wider">Warning</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-blue-500 uppercase tracking-wider">Notice</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-emerald-500 uppercase tracking-wider">Safe</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider w-32">Risk Bar</th>
                </tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <ServiceRow key={service.serviceName} service={service} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showUpload && (
        <UploadScanModal onClose={() => setShowUpload(false)} onSuccess={load} />
      )}
    </div>
  );
}
