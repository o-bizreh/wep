import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { DOCS_SECTIONS } from './docs-content';

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function DocCard({ section }: { section: (typeof DOCS_SECTIONS)[number] }) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(`/docs/${section.id}`)}
      className="group text-left rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-sm hover:-translate-y-1 transition-transform duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      {/* Gradient header */}
      <div className={`bg-gradient-to-br ${section.color} px-5 py-5 flex items-center gap-3`}>
        <span className="text-3xl" role="img" aria-label={section.title}>
          {section.icon}
        </span>
        <span className="text-white font-bold text-lg leading-tight">{section.title}</span>
      </div>

      {/* Body */}
      <div className="px-5 py-4 flex flex-col gap-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
          {section.description}
        </p>

        <div className="flex items-center justify-between mt-auto">
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {section.topics.length} {section.topics.length === 1 ? 'topic' : 'topics'}
          </span>
          <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400 group-hover:underline">
            Read docs →
          </span>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function DocsPage() {
  const [query, setQuery] = useState('');

  const filtered = query.trim()
    ? DOCS_SECTIONS.filter(
        (s) =>
          s.title.toLowerCase().includes(query.toLowerCase()) ||
          s.description.toLowerCase().includes(query.toLowerCase()),
      )
    : DOCS_SECTIONS;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-white/90 dark:bg-zinc-950/90 backdrop-blur border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-screen-xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100 tracking-tight">
              WEP
            </span>
            <span className="text-zinc-300 dark:text-zinc-600">/</span>
            <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
              Documentation
            </span>
          </div>
          <Link
            to="/"
            className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to platform
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="max-w-screen-xl mx-auto px-6 pt-12 pb-8">
        <h1 className="text-4xl font-extrabold text-zinc-900 dark:text-zinc-50 mb-2">
          Documentation
        </h1>
        <p className="text-zinc-500 dark:text-zinc-400 text-lg mb-8">
          Everything you need to know about using WEP
        </p>

        {/* Search */}
        <input
          type="search"
          placeholder="Search documentation…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full max-w-md px-4 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Card grid */}
      <div className="max-w-screen-xl mx-auto px-6 pb-20">
        {filtered.length === 0 ? (
          <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-4">
            No sections match your search.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((section) => (
              <DocCard key={section.id} section={section} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
