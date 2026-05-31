import { useState } from 'react';
import { StaleServicesPage } from '../catalog/StaleServicesPage';
import { ProjectHealthPage } from './ProjectHealthPage';
import { QualityTrendPage } from './QualityTrendPage';

type TabKey = 'stale' | 'project-health' | 'quality-trend';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'stale',         label: 'Stale Services' },
  { key: 'project-health', label: 'Project Health' },
  { key: 'quality-trend', label: 'Quality Trend' },
];

export function HealthSignalsPage() {
  const [tab, setTab] = useState<TabKey>('project-health');
  const [activated, setActivated] = useState<Set<TabKey>>(new Set(['project-health']));

  const handleTabClick = (key: TabKey) => {
    setTab(key);
    setActivated((prev) => new Set([...prev, key]));
  };

  return (
    <div className="space-y-0">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => handleTabClick(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab panels — only mount when first activated, then hide/show via display */}
      <div style={{ display: tab === 'stale' ? undefined : 'none' }}>
        {activated.has('stale') && <StaleServicesPage />}
      </div>
      <div style={{ display: tab === 'project-health' ? undefined : 'none' }}>
        {activated.has('project-health') && <ProjectHealthPage />}
      </div>
      <div style={{ display: tab === 'quality-trend' ? undefined : 'none' }}>
        {activated.has('quality-trend') && <QualityTrendPage />}
      </div>
    </div>
  );
}
