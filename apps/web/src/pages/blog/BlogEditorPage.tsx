import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Save, Send, Eye, PenLine, Tag, X, Link2,
  Image, AlignLeft, Hash, Bold, Italic, Code, List, Quote,
  CheckCircle2, AlertCircle, Loader2,
} from 'lucide-react';
import { fetchApi } from '../../lib/api';

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  summary: string;
  content: string;
  author: string;
  authorName: string;
  tags: string[];
  coverImageUrl?: string;
  demoUrl?: string;
  status: 'draft' | 'published';
  publishedAt: string | null;
  createdAt: string;
  readingTimeMinutes: number;
  reactions: { likes: number };
}

// ─── Markdown preview (inline formatting + block elements) ───────────────────

function inlineFormat(text: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[0.85em] font-mono text-rose-600 dark:text-rose-400">{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} className="font-semibold text-zinc-900 dark:text-white">{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function renderMarkdown(content: string): JSX.Element[] {
  const elements: JSX.Element[] = [];
  content.split(/\n{2,}/).forEach((block, idx) => {
    const t = block.trim();
    if (!t) return;
    if (t.startsWith('```')) {
      const lines = t.split('\n');
      const lang = lines[0]?.replace('```', '') || '';
      const code = lines.slice(1, lines[lines.length - 1]?.startsWith('```') ? -1 : undefined).join('\n');
      elements.push(
        <div key={idx} className="my-5 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
          {lang && <div className="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400">{lang}</div>}
          <pre className="overflow-x-auto bg-zinc-950 p-4 text-sm text-zinc-100"><code>{code}</code></pre>
        </div>,
      );
      return;
    }
    const h1 = t.match(/^# (.+)/); if (h1) { elements.push(<h2 key={idx} className="mt-8 mb-2 text-2xl font-black tracking-tight text-zinc-900 dark:text-white">{h1[1]}</h2>); return; }
    const h2 = t.match(/^## (.+)/); if (h2) { elements.push(<h3 key={idx} className="mt-6 mb-2 text-xl font-bold text-zinc-900 dark:text-white">{h2[1]}</h3>); return; }
    const h3 = t.match(/^### (.+)/); if (h3) { elements.push(<h4 key={idx} className="mt-4 mb-1 text-base font-bold text-zinc-800 dark:text-zinc-200">{h3[1]}</h4>); return; }
    if (t.startsWith('> ')) {
      elements.push(<blockquote key={idx} className="my-4 rounded-r-xl border-l-4 border-teal-400 bg-teal-50/50 dark:bg-teal-950/20 pl-4 pr-3 py-2 text-zinc-700 dark:text-zinc-300 italic text-sm">{inlineFormat(t.replace(/^> /, ''))}</blockquote>);
      return;
    }
    const lines = t.split('\n');
    if (lines.every((l) => /^[-*] /.test(l))) {
      elements.push(<ul key={idx} className="my-3 space-y-1 pl-0 list-none">{lines.map((l, li) => <li key={li} className="flex items-start gap-2 text-zinc-700 dark:text-zinc-300 text-sm leading-relaxed"><span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-teal-500" /><span>{inlineFormat(l.replace(/^[-*] /, ''))}</span></li>)}</ul>);
      return;
    }
    if (lines.every((l) => /^\d+\. /.test(l))) {
      elements.push(<ol key={idx} className="my-3 space-y-1 pl-0 list-none">{lines.map((l, li) => <li key={li} className="flex items-start gap-2 text-zinc-700 dark:text-zinc-300 text-sm leading-relaxed"><span className="flex-none flex h-5 w-5 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/40 text-[10px] font-bold text-teal-700 dark:text-teal-400 mt-0.5">{li + 1}</span><span>{inlineFormat(l.replace(/^\d+\. /, ''))}</span></li>)}</ol>);
      return;
    }
    elements.push(<p key={idx} className="my-3 leading-relaxed text-zinc-600 dark:text-zinc-400 text-sm">{inlineFormat(t)}</p>);
  });
  return elements;
}

// ─── Toolbar button ───────────────────────────────────────────────────────────

function ToolbarBtn({ icon: Icon, label, onClick }: { icon: typeof Bold; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function BlogEditorPage() {
  const { id: editId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [demoUrl, setDemoUrl] = useState('');
  const [author, setAuthor] = useState(() => localStorage.getItem('wep_author') ?? '');
  const [authorName, setAuthorName] = useState(() => localStorage.getItem('wep_author_name') ?? '');

  const [savedPostId, setSavedPostId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [publishing, setPublishing] = useState(false);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [metaOpen, setMetaOpen] = useState(true);

  useEffect(() => {
    if (!editId) return;
    fetchApi<BlogPost>(`/blog/posts/${editId}`)
      .then((post) => {
        setTitle(post.title); setSummary(post.summary); setContent(post.content);
        setTags(post.tags); setCoverImageUrl(post.coverImageUrl ?? '');
        setDemoUrl(post.demoUrl ?? ''); setAuthor(post.author);
        setAuthorName(post.authorName); setSavedPostId(post.id);
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Failed to load post'));
  }, [editId]);

  useEffect(() => { localStorage.setItem('wep_author', author); }, [author]);
  useEffect(() => { localStorage.setItem('wep_author_name', authorName); }, [authorName]);

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));
  const canSave = title.trim() && content.trim() && author.trim() && authorName.trim() && summary.trim();

  const addTag = useCallback(() => {
    const trimmed = tagsInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) setTags((p) => [...p, trimmed]);
    setTagsInput('');
  }, [tagsInput, tags]);

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
  };

  const insertSnippet = (before: string, after = '', placeholder = 'text') => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = content.slice(start, end) || placeholder;
    const next = content.slice(0, start) + before + selected + after + content.slice(end);
    setContent(next);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + before.length, start + before.length + selected.length);
    }, 0);
  };

  const handleSaveDraft = async () => {
    if (!canSave) return;
    setSaveStatus('saving');
    try {
      if (savedPostId) {
        await fetchApi(`/blog/posts/${savedPostId}`, {
          method: 'PUT',
          body: JSON.stringify({ title, summary, content, tags, coverImageUrl: coverImageUrl || undefined, demoUrl: demoUrl || undefined }),
        });
      } else {
        const created = await fetchApi<BlogPost>('/blog/posts', {
          method: 'POST',
          body: JSON.stringify({ title, summary, content, author, authorName, tags, coverImageUrl: coverImageUrl || undefined, demoUrl: demoUrl || undefined }),
        });
        setSavedPostId(created.id);
      }
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch { setSaveStatus('error'); }
  };

  const handlePublish = async () => {
    if (!canSave) return;
    if (!savedPostId) await handleSaveDraft();
    const id = savedPostId;
    if (!id) return;
    setPublishing(true);
    try {
      const published = await fetchApi<BlogPost>(`/blog/posts/${id}/publish`, { method: 'POST', body: '{}' });
      navigate(`/blog/${published.slug}`);
    } catch { setPublishing(false); }
  };

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="text-center">
          <p className="text-zinc-500">{loadError}</p>
          <button onClick={() => navigate('/blog')} className="mt-4 text-sm font-semibold text-teal-600 hover:underline">← Back to Blog</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-50 dark:bg-zinc-950 overflow-hidden">

      {/* ── Top bar ── */}
      <header className="flex-none flex items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/blog')}
            className="flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Blog</span>
          </button>
          <span className="text-zinc-300 dark:text-zinc-700">/</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Post title…"
            className="flex-1 min-w-0 bg-transparent text-base font-bold text-zinc-900 dark:text-white placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:outline-none"
          />
        </div>

        <div className="flex flex-none items-center gap-2">
          {/* Save status */}
          <span className="hidden sm:flex items-center gap-1.5 text-xs font-medium">
            {saveStatus === 'saving' && <><Loader2 className="h-3 w-3 animate-spin text-zinc-400" /><span className="text-zinc-400">Saving…</span></>}
            {saveStatus === 'saved' && <><CheckCircle2 className="h-3 w-3 text-teal-500" /><span className="text-teal-600 dark:text-teal-400">Saved</span></>}
            {saveStatus === 'error' && <><AlertCircle className="h-3 w-3 text-red-500" /><span className="text-red-500">Save failed</span></>}
          </span>

          {/* Write / Preview toggle */}
          <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden text-xs font-semibold">
            <button
              onClick={() => setMode('write')}
              className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${mode === 'write' ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900' : 'bg-white dark:bg-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
            >
              <PenLine className="h-3 w-3" /> Write
            </button>
            <button
              onClick={() => setMode('preview')}
              className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${mode === 'preview' ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900' : 'bg-white dark:bg-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
            >
              <Eye className="h-3 w-3" /> Preview
            </button>
          </div>

          <button
            onClick={handleSaveDraft}
            disabled={!canSave || saveStatus === 'saving'}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-40 transition-colors"
          >
            <Save className="h-3.5 w-3.5" /> Save
          </button>

          <button
            onClick={handlePublish}
            disabled={!canSave || publishing}
            className="flex items-center gap-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-40 transition-colors shadow-md shadow-teal-600/20"
          >
            {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: editor or preview ── */}
        <div className="flex flex-1 flex-col overflow-hidden">

          {mode === 'write' ? (
            <>
              {/* Markdown toolbar */}
              <div className="flex-none flex items-center gap-0.5 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-1.5">
                <ToolbarBtn icon={Bold}   label="Bold"        onClick={() => insertSnippet('**', '**')} />
                <ToolbarBtn icon={Italic} label="Italic"      onClick={() => insertSnippet('*', '*')} />
                <ToolbarBtn icon={Code}   label="Inline code" onClick={() => insertSnippet('`', '`')} />
                <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
                <ToolbarBtn icon={Hash}       label="Heading"    onClick={() => insertSnippet('## ', '', 'Heading')} />
                <ToolbarBtn icon={List}       label="List"       onClick={() => insertSnippet('- ', '', 'item')} />
                <ToolbarBtn icon={Quote}      label="Blockquote" onClick={() => insertSnippet('> ', '', 'quote')} />
                <ToolbarBtn icon={AlignLeft}  label="Code block" onClick={() => insertSnippet('```\n', '\n```', 'code')} />
                <span className="ml-auto text-[11px] text-zinc-400 font-medium">
                  {wordCount} words · {readingTime} min read
                </span>
              </div>

              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={`Write in Markdown…\n\n## Introduction\n\nTell your story here.`}
                className="flex-1 resize-none bg-white dark:bg-zinc-900 px-8 py-6 font-mono text-sm leading-relaxed text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:outline-none"
                spellCheck
              />
            </>
          ) : (
            <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900 px-8 sm:px-16 py-10">
              {title && <h1 className="mb-4 text-3xl font-black tracking-tight text-zinc-900 dark:text-white">{title}</h1>}
              {summary && <p className="mb-6 text-base text-zinc-500 dark:text-zinc-400 italic border-l-4 border-teal-400 pl-4">{summary}</p>}
              {tags.length > 0 && (
                <div className="mb-6 flex flex-wrap gap-2">
                  {tags.map((t) => <span key={t} className="rounded-full bg-teal-100 dark:bg-teal-900/40 px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400">{t}</span>)}
                </div>
              )}
              {content ? renderMarkdown(content) : <p className="text-sm text-zinc-400 italic">Start writing to see your preview…</p>}
            </div>
          )}
        </div>

        {/* ── Right: metadata panel ── */}
        <aside className="hidden lg:flex flex-none w-72 flex-col border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-y-auto">
          <button
            onClick={() => setMetaOpen((o) => !o)}
            className="flex items-center justify-between px-5 py-3.5 text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 border-b border-zinc-100 dark:border-zinc-800"
          >
            Post Settings
            <span className={`transition-transform ${metaOpen ? 'rotate-180' : ''}`}>▾</span>
          </button>

          {metaOpen && (
            <div className="flex flex-col gap-5 p-5">

              {/* Author */}
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                  <PenLine className="h-3 w-3" /> Author
                </label>
                <input
                  type="text"
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  placeholder="Omar Bizreh"
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500/30"
                />
                <input
                  type="text"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="username (e.g. omar.bizreh)"
                  className="mt-2 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400 placeholder:text-zinc-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500/30"
                />
              </div>

              {/* Summary */}
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                  <AlignLeft className="h-3 w-3" /> Summary
                </label>
                <textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  rows={3}
                  placeholder="1–2 sentence description shown in the list view."
                  className="w-full resize-none rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500/30"
                />
              </div>

              {/* Tags */}
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                  <Tag className="h-3 w-3" /> Tags
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    placeholder="e.g. nodejs, devops"
                    className="flex-1 min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:border-teal-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={addTag}
                    className="rounded-lg bg-zinc-100 dark:bg-zinc-700 px-2.5 text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600"
                  >
                    Add
                  </button>
                </div>
                {tags.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800 px-2.5 py-0.5 text-xs font-semibold text-teal-700 dark:text-teal-400">
                        {tag}
                        <button type="button" onClick={() => setTags((p) => p.filter((t) => t !== tag))}>
                          <X className="h-2.5 w-2.5 hover:text-teal-900 dark:hover:text-teal-200" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Cover image */}
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                  <Image className="h-3 w-3" /> Cover Image URL
                </label>
                <input
                  type="url"
                  value={coverImageUrl}
                  onChange={(e) => setCoverImageUrl(e.target.value)}
                  placeholder="https://…"
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500/30"
                />
                {coverImageUrl && (
                  <img src={coverImageUrl} alt="" className="mt-2 w-full rounded-lg object-cover h-24" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
              </div>

              {/* Demo URL */}
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                  <Link2 className="h-3 w-3" /> Demo URL
                </label>
                <input
                  type="url"
                  value={demoUrl}
                  onChange={(e) => setDemoUrl(e.target.value)}
                  placeholder="https://…"
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-xs text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500/30"
                />
              </div>

              {/* Stats */}
              <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-800 p-3 space-y-2 text-xs text-zinc-500">
                <div className="flex justify-between"><span>Words</span><span className="font-semibold text-zinc-700 dark:text-zinc-300">{wordCount}</span></div>
                <div className="flex justify-between"><span>Reading time</span><span className="font-semibold text-zinc-700 dark:text-zinc-300">{readingTime} min</span></div>
                <div className="flex justify-between"><span>Tags</span><span className="font-semibold text-zinc-700 dark:text-zinc-300">{tags.length}</span></div>
                <div className="flex justify-between"><span>Status</span><span className={`font-semibold ${savedPostId ? 'text-teal-600 dark:text-teal-400' : 'text-zinc-400'}`}>{savedPostId ? 'Draft saved' : 'Unsaved'}</span></div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
