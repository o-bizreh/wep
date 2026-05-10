import { useState, type ReactNode } from 'react';
import { clsx } from 'clsx';

interface Tab {
  key: string;
  label: string;
  content: ReactNode;
}

interface DetailPageLayoutProps {
  header: ReactNode;
  tabs: Tab[];
  defaultTab?: string;
  onTabChange?: (key: string) => void;
}

export function DetailPageLayout({ header, tabs, defaultTab, onTabChange }: DetailPageLayoutProps) {
  const [activeTab, setActiveTab] = useState(defaultTab ?? tabs[0]?.key ?? '');

  const handleTabClick = (key: string) => {
    setActiveTab(key);
    onTabChange?.(key);
  };

  const currentTab = tabs.find((t) => t.key === activeTab);

  return (
    <div>
      <div className="mb-6">{header}</div>
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabClick(tab.key)}
              className={clsx(
                'whitespace-nowrap border-b-2 py-3 text-sm font-medium transition-colors',
                activeTab === tab.key
                  ? 'border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200',
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="mt-6">{currentTab?.content}</div>
    </div>
  );
}
