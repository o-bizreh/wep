import { useState } from 'react';
import { DependencyMapPage } from './DependencyMapPage';
import { CouplingDetectorPage } from './CouplingDetectorPage';

export function ServiceGraphPage() {
  const [tab, setTab] = useState<'deps' | 'coupling'>('deps');

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-6">
        {[{ key: 'deps', label: 'Dependency Map' }, { key: 'coupling', label: 'Coupling Detector' }].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as 'deps' | 'coupling')}
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
      <div style={{ display: tab === 'deps' ? undefined : 'none' }}><DependencyMapPage /></div>
      <div style={{ display: tab === 'coupling' ? undefined : 'none' }}><CouplingDetectorPage /></div>
    </div>
  );
}
