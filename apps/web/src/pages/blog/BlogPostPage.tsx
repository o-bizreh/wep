import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, Heart, ExternalLink, Edit3 } from 'lucide-react';
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

// ─── Markdown Renderer ────────────────────────────────────────────────────────

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
  const blocks = content.split(/\n{2,}/);

  blocks.forEach((block, idx) => {
    const t = block.trim();
    if (!t) return;

    if (t.startsWith('```')) {
      const lines = t.split('\n');
      const lang = lines[0]?.replace('```', '') || '';
      const code = lines.slice(1, lines[lines.length - 1]?.startsWith('```') ? -1 : undefined).join('\n');
      elements.push(
        <div key={idx} className="my-6 overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-700/60">
          {lang && (
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-zinc-800/60 px-4 py-2">
              <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">{lang}</span>
            </div>
          )}
          <pre className="overflow-x-auto bg-zinc-950 p-5 text-sm leading-relaxed text-zinc-100">
            <code>{code}</code>
          </pre>
        </div>,
      );
      return;
    }

    const h1 = t.match(/^# (.+)/);
    if (h1) {
      elements.push(<h2 key={idx} className="mt-10 mb-3 text-2xl font-black tracking-tight text-zinc-900 dark:text-white">{h1[1]}</h2>);
      return;
    }
    const h2 = t.match(/^## (.+)/);
    if (h2) {
      elements.push(<h3 key={idx} className="mt-8 mb-2 text-xl font-bold text-zinc-900 dark:text-white">{h2[1]}</h3>);
      return;
    }
    const h3 = t.match(/^### (.+)/);
    if (h3) {
      elements.push(<h4 key={idx} className="mt-6 mb-2 text-base font-bold text-zinc-800 dark:text-zinc-200">{h3[1]}</h4>);
      return;
    }

    if (t.startsWith('> ')) {
      elements.push(
        <blockquote key={idx} className="my-6 rounded-r-xl border-l-4 border-teal-400 bg-teal-50/50 dark:bg-teal-950/20 pl-5 pr-4 py-3 text-zinc-700 dark:text-zinc-300 italic text-[0.95rem] leading-relaxed">
          {inlineFormat(t.replace(/^> /, ''))}
        </blockquote>,
      );
      return;
    }

    const lines = t.split('\n');
    if (lines.every((l) => /^[-*] /.test(l))) {
      elements.push(
        <ul key={idx} className="my-4 space-y-1.5 pl-0 list-none">
          {lines.map((l, li) => (
            <li key={li} className="flex items-start gap-2.5 text-zinc-700 dark:text-zinc-300 leading-relaxed">
              <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-teal-500" />
              <span>{inlineFormat(l.replace(/^[-*] /, ''))}</span>
            </li>
          ))}
        </ul>,
      );
      return;
    }

    if (lines.every((l) => /^\d+\. /.test(l))) {
      elements.push(
        <ol key={idx} className="my-4 space-y-1.5 pl-0 list-none counter-reset-item">
          {lines.map((l, li) => (
            <li key={li} className="flex items-start gap-3 text-zinc-700 dark:text-zinc-300 leading-relaxed">
              <span className="flex-none flex h-6 w-6 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/40 text-[11px] font-bold text-teal-700 dark:text-teal-400 mt-0.5">{li + 1}</span>
              <span>{inlineFormat(l.replace(/^\d+\. /, ''))}</span>
            </li>
          ))}
        </ol>,
      );
      return;
    }

    elements.push(
      <p key={idx} className="my-4 leading-[1.85] text-zinc-600 dark:text-zinc-400 text-[0.975rem]">
        {inlineFormat(t)}
      </p>,
    );
  });

  return elements;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function AuthorAvatar({ name }: { name: string }) {
  const initials = name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
  const colors = ['from-teal-500 to-cyan-500', 'from-violet-500 to-purple-600', 'from-rose-500 to-pink-500', 'from-amber-500 to-orange-500'];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <span className={`inline-flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br ${color} text-sm font-bold text-white shadow-md`}>
      {initials}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [likes, setLikes] = useState(0);
  const [liked, setLiked] = useState(false);
  const [liking, setLiking] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    fetchApi<BlogPost>(`/blog/posts/${slug}`)
      .then((data) => { setPost(data); setLikes(data.reactions.likes); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load post'))
      .finally(() => setLoading(false));
  }, [slug]);

  const handleLike = async () => {
    if (!post || liking || liked) return;
    setLiking(true);
    try {
      await fetchApi(`/blog/posts/${post.id}/react`, { method: 'POST', body: '{}' });
      setLikes((l) => l + 1);
      setLiked(true);
    } catch { /* ignore */ }
    finally { setLiking(false); }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-zinc-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-500 border-t-transparent" />
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <p className="text-zinc-500 dark:text-zinc-400">{error ?? 'Post not found.'}</p>
        <button onClick={() => navigate('/blog')} className="mt-6 text-sm font-semibold text-teal-600 hover:underline dark:text-teal-400">
          ← Back to Blog
        </button>
      </div>
    );
  }

  const gradients = [
    'from-teal-500 via-cyan-500 to-blue-500',
    'from-violet-500 via-purple-500 to-indigo-600',
    'from-rose-500 via-pink-500 to-orange-400',
    'from-amber-400 via-orange-500 to-red-500',
    'from-emerald-500 via-teal-500 to-cyan-600',
  ];
  const gradient = gradients[(post.title.charCodeAt(0) ?? 0) % gradients.length];

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Hero */}
      <div className={`relative w-full bg-gradient-to-br ${gradient} overflow-hidden`} style={{ minHeight: post.coverImageUrl ? 0 : '320px' }}>
        {post.coverImageUrl ? (
          <>
            <img src={post.coverImageUrl} alt={post.title} className="h-80 w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          </>
        ) : (
          <>
            {/* decorative shapes */}
            <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full bg-white/10 blur-3xl pointer-events-none" />
            <div className="absolute -left-10 bottom-0 h-60 w-60 rounded-full bg-white/10 blur-2xl pointer-events-none" />
          </>
        )}

        {/* Back button inside hero */}
        <div className="absolute top-6 left-6">
          <button
            onClick={() => navigate('/blog')}
            className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-black/20 backdrop-blur-md px-4 py-2 text-sm font-semibold text-white hover:bg-black/30 transition-all"
          >
            <ArrowLeft className="h-4 w-4" /> Blog
          </button>
        </div>

        {/* Edit shortcut */}
        <div className="absolute top-6 right-6">
          <button
            onClick={() => navigate(`/blog/edit/${post.id}`)}
            className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-black/20 backdrop-blur-md px-4 py-2 text-sm font-semibold text-white hover:bg-black/30 transition-all"
          >
            <Edit3 className="h-4 w-4" /> Edit
          </button>
        </div>

        {/* Hero text (only when no cover image) */}
        {!post.coverImageUrl && (
          <div className="relative flex items-end h-80 px-8 pb-10 max-w-4xl mx-auto">
            <div>
              <div className="flex flex-wrap gap-2 mb-4">
                {post.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-white/20 backdrop-blur-sm border border-white/30 px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-white">
                    {tag}
                  </span>
                ))}
              </div>
              <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white leading-tight max-w-2xl">
                {post.title}
              </h1>
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="mx-auto max-w-3xl px-5 sm:px-8 pb-24">

        {/* Title below cover image */}
        {post.coverImageUrl && (
          <div className="pt-10 pb-2">
            <div className="flex flex-wrap gap-2 mb-4">
              {post.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-teal-100 dark:bg-teal-900/40 px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400">
                  {tag}
                </span>
              ))}
            </div>
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-zinc-900 dark:text-white leading-tight">
              {post.title}
            </h1>
          </div>
        )}

        {/* Author + meta row */}
        <div className={`flex flex-wrap items-center gap-4 py-6 ${!post.coverImageUrl ? 'mt-0 border-t-0' : ''} border-b border-zinc-200 dark:border-zinc-800`}>
          <AuthorAvatar name={post.authorName} />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-zinc-900 dark:text-white text-sm">{post.authorName}</p>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              <span>{formatDate(post.publishedAt)}</span>
              <span className="h-1 w-1 rounded-full bg-zinc-300 dark:bg-zinc-600" />
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{post.readingTimeMinutes} min read</span>
            </div>
          </div>
          {post.demoUrl && (
            <a
              href={post.demoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 px-4 py-2 text-xs font-bold text-white transition-colors shadow-md shadow-teal-600/20"
            >
              <ExternalLink className="h-3.5 w-3.5" /> View Demo
            </a>
          )}
        </div>

        {/* Summary */}
        {post.summary && (
          <p className="mt-8 text-lg font-medium leading-relaxed text-zinc-700 dark:text-zinc-300 border-l-4 border-teal-400 pl-5 py-1">
            {post.summary}
          </p>
        )}

        {/* Content */}
        <article className="mt-6">
          {renderMarkdown(post.content)}
        </article>

        {/* Footer */}
        <div className="mt-14 pt-8 border-t border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          {/* Like */}
          <button
            onClick={handleLike}
            disabled={liking || liked}
            className={`group inline-flex items-center gap-2.5 rounded-2xl border px-5 py-3 text-sm font-semibold transition-all ${
              liked
                ? 'border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400'
                : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 hover:border-rose-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:border-rose-800 dark:hover:bg-rose-950/30'
            } disabled:cursor-default`}
          >
            <Heart className={`h-4 w-4 transition-transform group-hover:scale-110 ${liked ? 'fill-current' : ''}`} />
            <span>{likes} {likes === 1 ? 'Like' : 'Likes'}</span>
          </button>

          {/* Author card */}
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-3">
            <AuthorAvatar name={post.authorName} />
            <div>
              <p className="text-xs text-zinc-400 font-medium">Written by</p>
              <p className="text-sm font-bold text-zinc-900 dark:text-white">{post.authorName}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
