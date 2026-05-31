import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { PenLine, Clock, Heart, Search, Tag, ChevronRight, BookOpen } from 'lucide-react';
import { fetchApi } from '../../lib/api';

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  summary: string;
  author: string;
  authorName: string;
  tags: string[];
  coverImageUrl?: string;
  publishedAt: string | null;
  readingTimeMinutes: number;
  reactions: { likes: number };
}

function formatDate(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function AuthorAvatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  const initials = name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
  const colors = ['from-teal-500 to-cyan-500', 'from-violet-500 to-purple-600', 'from-rose-500 to-pink-500', 'from-amber-500 to-orange-500', 'from-blue-500 to-indigo-600'];
  const color = colors[name.charCodeAt(0) % colors.length];
  const sz = size === 'md' ? 'h-10 w-10 text-sm' : 'h-7 w-7 text-[10px]';
  return (
    <span className={`inline-flex flex-none items-center justify-center rounded-full bg-gradient-to-br ${color} ${sz} font-bold text-white`}>
      {initials}
    </span>
  );
}

const COVER_GRADIENTS = [
  'from-teal-500 via-cyan-500 to-blue-500',
  'from-violet-500 via-purple-500 to-indigo-600',
  'from-rose-500 via-pink-500 to-orange-400',
  'from-amber-400 via-orange-500 to-red-500',
  'from-emerald-500 via-teal-500 to-cyan-600',
  'from-blue-500 via-indigo-500 to-violet-600',
];

function PostGradient({ title, className }: { title: string; className?: string }) {
  const g = COVER_GRADIENTS[title.charCodeAt(0) % COVER_GRADIENTS.length];
  return <div className={`bg-gradient-to-br ${g} ${className}`} />;
}

// ─── Featured card (first post) ──────────────────────────────────────────────

function FeaturedCard({ post }: { post: BlogPost }) {
  const navigate = useNavigate();
  return (
    <div
      onClick={() => navigate(`/blog/${post.slug}`)}
      className="group relative flex flex-col overflow-hidden rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl hover:shadow-2xl transition-all duration-500 cursor-pointer lg:flex-row"
    >
      {/* Image / gradient */}
      <div className="relative h-56 flex-none overflow-hidden lg:h-auto lg:w-2/5">
        {post.coverImageUrl
          ? <img src={post.coverImageUrl} alt={post.title} className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-700" />
          : <PostGradient title={post.title} className="h-full w-full group-hover:scale-105 transition-transform duration-700" />
        }
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
        <span className="absolute top-4 left-4 rounded-full bg-white/20 backdrop-blur-md border border-white/30 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white">
          Featured
        </span>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col justify-between p-8">
        <div>
          <div className="flex flex-wrap gap-2 mb-4">
            {post.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded-full bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400">
                {tag}
              </span>
            ))}
          </div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-zinc-900 dark:text-white leading-tight group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">
            {post.title}
          </h2>
          <p className="mt-3 text-base text-zinc-500 dark:text-zinc-400 leading-relaxed line-clamp-3">
            {post.summary}
          </p>
        </div>

        <div className="mt-8 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AuthorAvatar name={post.authorName} size="md" />
            <div>
              <p className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{post.authorName}</p>
              <p className="text-xs text-zinc-400">{formatDate(post.publishedAt)} · {post.readingTimeMinutes} min read</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-zinc-400 text-xs">
            <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5" />{post.reactions.likes}</span>
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 opacity-0 group-hover:opacity-100 translate-x-4 group-hover:translate-x-0 transition-all duration-300 shadow-lg">
              <ChevronRight className="h-5 w-5" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Regular post card ────────────────────────────────────────────────────────

function PostCard({ post }: { post: BlogPost }) {
  const navigate = useNavigate();
  return (
    <div
      onClick={() => navigate(`/blog/${post.slug}`)}
      className="group flex flex-col overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer"
    >
      {/* Cover */}
      <div className="relative h-44 overflow-hidden">
        {post.coverImageUrl
          ? <img src={post.coverImageUrl} alt={post.title} className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500" />
          : <PostGradient title={post.title} className="h-full w-full group-hover:scale-105 transition-transform duration-500" />
        }
        {post.tags[0] && (
          <span className="absolute bottom-3 left-3 rounded-full bg-black/40 backdrop-blur-sm px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            {post.tags[0]}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-base font-black tracking-tight text-zinc-900 dark:text-white leading-snug group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors line-clamp-2">
          {post.title}
        </h3>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed line-clamp-2 flex-1">
          {post.summary}
        </p>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AuthorAvatar name={post.authorName} />
            <div>
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{post.authorName}</p>
              <p className="text-[10px] text-zinc-400">{formatDate(post.publishedAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-zinc-400">
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{post.readingTimeMinutes}m</span>
            <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{post.reactions.likes}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function BlogListPage() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);

  useEffect(() => {
    fetchApi<BlogPost[]>('/blog/posts')
      .then(setPosts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const allTags = Array.from(new Set(posts.flatMap((p) => p.tags))).slice(0, 12);

  const filtered = posts.filter((p) => {
    const matchesTag = !activeTag || p.tags.includes(activeTag);
    const q = search.toLowerCase();
    const matchesSearch = !q || p.title.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q) || p.authorName.toLowerCase().includes(q);
    return matchesTag && matchesSearch;
  });

  const [featured, ...rest] = filtered;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* ── Hero header ── */}
      <div className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-500 shadow-md shadow-teal-500/20">
                  <BookOpen className="h-5 w-5 text-white" />
                </div>
                <span className="text-xs font-black uppercase tracking-[0.3em] text-zinc-400">Washmen Engineering</span>
              </div>
              <h1 className="text-4xl font-black tracking-tight text-zinc-900 dark:text-white">
                Engineering Blog
              </h1>
              <p className="mt-2 text-base text-zinc-500 dark:text-zinc-400 max-w-lg">
                Ideas, learnings, and tools from the Washmen engineering team.
              </p>
            </div>
            <Link
              to="/blog/new"
              className="inline-flex flex-none items-center gap-2 rounded-2xl bg-zinc-900 dark:bg-white hover:bg-zinc-700 dark:hover:bg-zinc-100 px-5 py-3 text-sm font-bold text-white dark:text-zinc-900 shadow-lg transition-colors"
            >
              <PenLine className="h-4 w-4" /> Write a Post
            </Link>
          </div>

          {/* Search */}
          <div className="mt-8 relative max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search posts…"
              className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 pl-11 pr-4 py-3 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition"
            />
          </div>

          {/* Tag filters */}
          {allTags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => setActiveTag(null)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                  !activeTag
                    ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                All
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                    activeTag === tag
                      ? 'bg-teal-600 text-white'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                >
                  <Tag className="h-2.5 w-2.5" />{tag}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="mx-auto max-w-6xl px-6 py-12">
        {loading ? (
          <div className="flex justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-500 border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <BookOpen className="h-12 w-12 text-zinc-200 dark:text-zinc-700 mb-4" />
            <p className="text-lg font-bold text-zinc-400 dark:text-zinc-500">
              {search || activeTag ? 'No posts match your search.' : 'No posts yet.'}
            </p>
            {!search && !activeTag && (
              <Link to="/blog/new" className="mt-4 text-sm font-semibold text-teal-600 hover:underline dark:text-teal-400">
                Write the first post →
              </Link>
            )}
          </div>
        ) : (
          <>
            {/* Featured */}
            {featured && !search && !activeTag && (
              <div className="mb-10">
                <FeaturedCard post={featured} />
              </div>
            )}

            {/* Grid */}
            {rest.length > 0 && (
              <>
                {!search && !activeTag && (
                  <h2 className="mb-6 text-xs font-black uppercase tracking-[0.3em] text-zinc-400">Latest Posts</h2>
                )}
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {(search || activeTag ? filtered : rest).map((post) => (
                    <PostCard key={post.id} post={post} />
                  ))}
                </div>
              </>
            )}

            {/* Edge case: only one post but searching */}
            {(search || activeTag) && filtered.length === 1 && (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                <PostCard post={filtered[0]!} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
