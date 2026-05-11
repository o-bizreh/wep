import { useState, useEffect } from 'react';
import { UserPlus, Trash2, Users, Shield } from 'lucide-react';
import { Spinner } from '@wep/ui';
import { fetchApi, portalApi } from '../../lib/api';

interface SecurityTeam {
  teamId: string;
  name: string;
  ownerUsername: string;
  memberUsernames: string[];
  createdAt: string;
  updatedAt: string;
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200/60 bg-white/60 shadow-xl shadow-slate-200/20 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/40 dark:shadow-black/40 ${className}`}>
      {children}
    </div>
  );
}

function Btn({ children, onClick, variant = 'primary', disabled, loading, size = 'md' }: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  size?: 'sm' | 'md';
}) {
  const base = 'inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50';
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-3.5 py-2 text-sm' };
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600',
    danger:  'bg-red-600 text-white hover:bg-red-700',
    ghost:   'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700',
  };
  return (
    <button onClick={onClick} disabled={disabled || loading} className={`${base} ${sizes[size]} ${variants[variant]}`}>
      {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

// ─── Add member inline form (DevOps only, plain username input) ───────────────

function AddMemberForm({ team, onAdded, onCancel }: {
  team: SecurityTeam;
  onAdded: (updated: SecurityTeam) => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const trimmed = username.trim();
    if (!trimmed) return;
    if (team.memberUsernames.includes(trimmed)) {
      setError('Already a member');
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const updated = await fetchApi<SecurityTeam>(`/security/teams/${team.teamId}`, {
        method: 'PUT',
        body: JSON.stringify({ memberUsernames: [...team.memberUsernames, trimmed] }),
      });
      onAdded(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add member');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-blue-200/60 bg-blue-50/40 dark:border-blue-900/30 dark:bg-blue-950/20 p-4 space-y-3">
      <p className="text-sm font-semibold text-zinc-900 dark:text-white">Add a member</p>
      <div className="flex gap-2">
        <input
          type="text"
          autoFocus
          placeholder="AWS username (e.g. omar.bizreh)"
          value={username}
          onChange={e => { setUsername(e.target.value); setError(null); }}
          onKeyDown={e => e.key === 'Enter' && void add()}
          className="flex-1 rounded-lg border border-zinc-200/60 bg-white/80 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400
            focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20
            dark:border-white/10 dark:bg-zinc-900/60 dark:text-white dark:placeholder:text-zinc-500"
        />
        <Btn onClick={add} disabled={!username.trim()} loading={adding}>
          <UserPlus className="h-3.5 w-3.5" /> Add
        </Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

// ─── Team card ────────────────────────────────────────────────────────────────

function TeamCard({ team, isDevOps, onUpdated }: {
  team: SecurityTeam;
  isDevOps: boolean;
  onUpdated: (updated: SecurityTeam) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [removingUsername, setRemovingUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(username: string) {
    setRemovingUsername(username);
    setError(null);
    try {
      const updated = await fetchApi<SecurityTeam>(`/security/teams/${team.teamId}`, {
        method: 'PUT',
        body: JSON.stringify({ memberUsernames: team.memberUsernames.filter(u => u !== username) }),
      });
      onUpdated(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove member');
    } finally {
      setRemovingUsername(null);
    }
  }

  return (
    <Card>
      <div className="border-b border-slate-200/50 px-6 py-5 dark:border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-900/30">
            <Users className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-white">{team.name}</h2>
            <p className="text-xs text-zinc-500">
              {team.memberUsernames.length} {team.memberUsernames.length === 1 ? 'member' : 'members'}
              {' · '}owner: <span className="font-mono">{team.ownerUsername}</span>
            </p>
          </div>
        </div>
        {isDevOps && (
          <Btn size="sm" onClick={() => setShowAdd(v => !v)}>
            <UserPlus className="h-3.5 w-3.5" /> Add member
          </Btn>
        )}
      </div>

      <div className="px-6 py-4">
        {error && <p className="mb-3 text-xs text-red-600 dark:text-red-400">{error}</p>}

        {showAdd && isDevOps && (
          <AddMemberForm
            team={team}
            onAdded={updated => { onUpdated(updated); setShowAdd(false); }}
            onCancel={() => setShowAdd(false)}
          />
        )}

        {team.memberUsernames.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">No members yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {team.memberUsernames.map(username => (
              <li key={username} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5 text-zinc-400" />
                  <span className="text-sm font-semibold text-zinc-900 dark:text-white font-mono">{username}</span>
                  {username === team.ownerUsername && (
                    <span className="rounded-full bg-indigo-100 dark:bg-indigo-900/30 px-2 py-0.5 text-[10px] font-bold text-indigo-600 dark:text-indigo-400">owner</span>
                  )}
                </div>
                {isDevOps && username !== team.ownerUsername && (
                  <Btn
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(username)}
                    loading={removingUsername === username}
                  >
                    <Trash2 className="h-3 w-3 text-red-500" />
                  </Btn>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function MyTeamPage() {
  const [teams, setTeams] = useState<SecurityTeam[]>([]);
  const [myUsername, setMyUsername] = useState<string | null>(null);
  const [isDevOps, setIsDevOps] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [role, allTeams] = await Promise.all([
          portalApi.getRole(),
          fetchApi<SecurityTeam[]>('/security/teams'),
        ]);
        setMyUsername(role.username);
        setIsDevOps(role.role === 'devops');
        // Non-DevOps see only teams they belong to
        const visible = (role.role === 'devops')
          ? allTeams
          : allTeams.filter(t => t.memberUsernames.includes(role.username ?? ''));
        setTeams(visible);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load teams');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-8 animate-fade-in mx-auto mt-4">
      <div className="px-2">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">My Team</h1>
        <p className="mt-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {isDevOps
            ? 'All teams — you can add and remove members.'
            : 'Your team membership. Contact DevOps to update it.'}
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
          {error}
        </div>
      )}

      {teams.length === 0 && !error ? (
        <Card>
          <div className="px-6 py-12 text-center">
            <Users className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-600" />
            <p className="mt-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              {isDevOps
                ? 'No teams yet. Create one in Settings → Teams.'
                : "You haven't been assigned to a team yet. Ask DevOps to add you."}
            </p>
          </div>
        </Card>
      ) : (
        teams.map(team => (
          <TeamCard
            key={team.teamId}
            team={team}
            isDevOps={isDevOps}
            onUpdated={updated => setTeams(prev => prev.map(t => t.teamId === updated.teamId ? updated : t))}
          />
        ))
      )}
    </div>
  );
}
