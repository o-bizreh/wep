import { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { DOCS_SECTIONS, type DocsSection, type DocsTopic } from './docs-content';

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function SectionSidebar({
  topics,
  activeId,
  onSelect,
}: {
  topics: DocsTopic[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="flex flex-col gap-0.5 py-4 pr-4">
      {topics.map((topic) => {
        const isActive = activeId === topic.id;
        return (
          <button
            key={topic.id}
            onClick={() => onSelect(topic.id)}
            className={[
              'w-full text-left px-3 py-1.5 rounded text-sm transition-colors border-l-2',
              isActive
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 font-medium'
                : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 hover:border-zinc-300 dark:hover:border-zinc-600',
            ].join(' ')}
          >
            {topic.title}
          </button>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Topic content block
// ---------------------------------------------------------------------------

function TopicBlock({ topic }: { topic: DocsTopic }) {
  const navigate = useNavigate();
  return (
    <div className="mb-12">
      <span id={topic.id} className="block" style={{ scrollMarginTop: '6rem' }} />
      <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mt-10 mb-3 pb-2 border-b border-zinc-200 dark:border-zinc-700">
        {topic.title}
      </h2>
      <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed mb-4">{topic.body}</p>

      {topic.tips && topic.tips.length > 0 && (
        <ul className="list-disc list-inside space-y-1.5 mb-4 text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed">
          {topic.tips.map((tip, i) => (
            <li key={i}>{tip}</li>
          ))}
        </ul>
      )}

      {topic.link && (
        <button
          onClick={() => navigate(topic.link!)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
        >
          Open {topic.title} →
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section nav (prev / next)
// ---------------------------------------------------------------------------

function SectionNav({ current }: { current: DocsSection }) {
  const idx = DOCS_SECTIONS.findIndex((s) => s.id === current.id);
  const prev = idx > 0 ? DOCS_SECTIONS[idx - 1] : undefined;
  const next = idx < DOCS_SECTIONS.length - 1 ? DOCS_SECTIONS[idx + 1] : undefined;

  return (
    <div className="mt-16 pt-6 border-t border-zinc-200 dark:border-zinc-700 flex items-center justify-between gap-4">
      {prev ? (
        <Link
          to={`/docs/${prev.id}`}
          className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 transition-colors"
        >
          ← {prev.title}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          to={`/docs/${next.id}`}
          className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 transition-colors"
        >
          {next.title} →
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function DocsSectionPage() {
  const { section: sectionId } = useParams<{ section: string }>();
  const navigate = useNavigate();

  const section = DOCS_SECTIONS.find((s) => s.id === sectionId);

  const [activeId, setActiveId] = useState<string>(section?.topics[0]?.id ?? '');
  const observerRef = useRef<IntersectionObserver | null>(null);
  const scrollingRef = useRef(false);

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    scrollingRef.current = true;
    setActiveId(id);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
      scrollingRef.current = false;
    }, 700);
  }, []);

  useEffect(() => {
    if (!section) return;
    setActiveId(section.topics[0]?.id ?? '');
  }, [section]);

  useEffect(() => {
    if (!section) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (scrollingRef.current) return;
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0 && visible[0] !== undefined) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: '-10% 0px -80% 0px', threshold: 0 },
    );

    section.topics.forEach((topic) => {
      const el = document.getElementById(topic.id);
      if (el) observerRef.current!.observe(el);
    });

    return () => observerRef.current?.disconnect();
  }, [section]);

  // 404 for unknown section
  if (!section) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-zinc-500 dark:text-zinc-400 mb-4">Section not found.</p>
          <button
            onClick={() => navigate('/docs')}
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            ← Back to Documentation
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
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

      {/* Breadcrumb */}
      <div className="max-w-screen-xl mx-auto px-6 py-3 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <Link
          to="/docs"
          className="hover:text-zinc-800 dark:hover:text-zinc-100 transition-colors"
        >
          Documentation
        </Link>
        <span>→</span>
        <span className="text-zinc-800 dark:text-zinc-100 font-medium">{section.title}</span>
      </div>

      <div className="max-w-screen-xl mx-auto flex">
        {/* Left sidebar — desktop */}
        <aside className="hidden lg:block w-56 shrink-0 sticky top-14 self-start h-[calc(100vh-3.5rem)] overflow-y-auto border-r border-zinc-100 dark:border-zinc-800">
          <SectionSidebar
            topics={section.topics}
            activeId={activeId}
            onSelect={scrollTo}
          />
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 px-6 pb-24 pt-4">
          {/* Section header */}
          <div className={`rounded-xl bg-gradient-to-br ${section.color} px-6 py-6 mb-8 flex items-center gap-4`}>
            <span className="text-4xl" role="img" aria-label={section.title}>
              {section.icon}
            </span>
            <div>
              <h1 className="text-2xl font-extrabold text-white">{section.title}</h1>
              <p className="text-white/80 text-sm mt-0.5">{section.description}</p>
            </div>
          </div>

          {/* Mobile topic list */}
          <div className="lg:hidden mb-6 flex flex-wrap gap-2">
            {section.topics.map((topic) => (
              <button
                key={topic.id}
                onClick={() => scrollTo(topic.id)}
                className={[
                  'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                  activeId === topic.id
                    ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700'
                    : 'text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:text-zinc-800 dark:hover:text-zinc-100',
                ].join(' ')}
              >
                {topic.title}
              </button>
            ))}
          </div>

          {/* Topics */}
          <div className="max-w-2xl">
            {section.topics.map((topic) => (
              <TopicBlock key={topic.id} topic={topic} />
            ))}
          </div>

          <div className="max-w-2xl">
            <SectionNav current={section} />
          </div>
        </main>
      </div>
    </div>
  );
}
