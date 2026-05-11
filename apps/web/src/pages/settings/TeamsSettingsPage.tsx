import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@wep/ui';
import { Users, Plus, Trash2, X, Loader2, UserPlus, UserMinus, Shield, Pencil, Check } from 'lucide-react';
import { useDialog } from '../../components/Dialog';
import { fetchApi, portalApi } from '../../lib/api';

interface SecurityTeam {
  teamId: string;
  name: string;
  ownerUsername: string;
  memberUsernames: string[];
  createdAt: string;
  updatedAt: string;
}

interface PlatformUser {
  username: string;
  email: string;
  roleName: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

function CreateTeamModal({ onClose, onCreated }: { onClose: () => void; onCreated: (t: SecurityTeam) => void }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Team name is required'); return; }
    setSaving(true);
    setError(null);
    try {
      const team = await fetchApi<SecurityTeam>('/security/teams', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      onCreated(team);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create team');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200/60 bg-white/90 dark:border-white/10 dark:bg-zinc-900/90 p-6 shadow-2xl">
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Create Team</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="h-5 w-5" /></button>
        </div>
        {error && <p className="mb-4 rounded-lg bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Team Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleSubmit()}
              placeholder="e.g. Facility Domain"
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm dark:text-white focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <button
            onClick={() => void handleSubmit()}
            disabled={saving || !name.trim()}
            className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Creating…' : 'Create Team'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddMemberModal({
  team,
  allUsers,
  onClose,
  onUpdated,
}: {
  team: SecurityTeam;
  allUsers: PlatformUser[];
  onClose: () => void;
  onUpdated: (t: SecurityTeam) => void;
}) {
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  const available = allUsers.filter(
    (u) => !team.memberUsernames.includes(u.username) &&
      (u.username.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()))
  );

  const handleAdd = async (user: PlatformUser) => {
    setSaving(user.username);
    try {
      const updated = await fetchApi<SecurityTeam>(`/security/teams/${team.teamId}`, {
        method: 'PUT',
        body: JSON.stringify({ memberUsernames: [...team.memberUsernames, user.username] }),
      });
      onUpdated(updated);
    } catch (e) {
      console.error('[teams] Add member failed:', e);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200/60 bg-white/90 dark:border-white/10 dark:bg-zinc-900/90 p-6 shadow-2xl">
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Add Member to {team.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="h-5 w-5" /></button>
        </div>
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by username or email…"
          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm dark:text-white mb-3 focus:ring-indigo-500 focus:border-indigo-500"
        />
        {available.length === 0 ? (
          <p className="text-sm text-center text-gray-400 py-4">No users to add.</p>
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {available.map((u) => (
              <div key={u.username} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/5">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{u.username}</p>
                  <p className="text-xs text-gray-400">{u.email}</p>
                </div>
                <button
                  onClick={() => { void handleAdd(u); }}
                  disabled={saving === u.username}
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving === u.username ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
                  Add
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TeamCard({
  team,
  allUsers,
  canEdit,
  canDelete,
  onUpdated,
  onDeleted,
}: {
  team: SecurityTeam;
  allUsers: PlatformUser[];
  canEdit: boolean;
  canDelete: boolean;
  onUpdated: (t: SecurityTeam) => void;
  onDeleted: (teamId: string) => void;
}) {
  const { confirm } = useDialog();
  const [showAddMember, setShowAddMember] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(team.name);
  const [savingName, setSavingName] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function saveName() {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === team.name) { setEditingName(false); return; }
    setSavingName(true);
    try {
      const updated = await fetchApi<SecurityTeam>(`/security/teams/${team.teamId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: trimmed }),
      });
      onUpdated(updated);
    } catch (e) {
      console.error('[teams] Rename failed:', e);
    } finally {
      setSavingName(false);
      setEditingName(false);
    }
  }

  const handleRemoveMember = async (username: string) => {
    setRemoving(username);
    try {
      const updated = await fetchApi<SecurityTeam>(`/security/teams/${team.teamId}`, {
        method: 'PUT',
        body: JSON.stringify({ memberUsernames: team.memberUsernames.filter((m) => m !== username) }),
      });
      onUpdated(updated);
    } catch (e) {
      console.error('[teams] Remove member failed:', e);
    } finally {
      setRemoving(null);
    }
  };

  const handleDelete = async () => {
    if (!await confirm({ title: `Delete "${team.name}"?`, message: 'This cannot be undone.', confirmLabel: 'Delete', variant: 'danger' })) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await fetchApi(`/security/teams/${team.teamId}`, { method: 'DELETE' });
      onDeleted(team.teamId);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete team');
      setDeleting(false);
    }
  };

  const members = allUsers.filter((u) => team.memberUsernames.includes(u.username));

  return (
    <div className="rounded-2xl border border-slate-200/60 bg-white dark:border-white/10 dark:bg-zinc-900/40 p-5 shadow-xl shadow-slate-200/20 dark:shadow-black/40">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Users className="h-4 w-4 text-indigo-500 shrink-0" />
            {editingName ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void saveName(); if (e.key === 'Escape') { setEditingName(false); setNameInput(team.name); } }}
                  className="rounded border border-indigo-300 bg-white dark:bg-zinc-800 dark:border-indigo-700 px-2 py-0.5 text-sm font-bold text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button onClick={() => void saveName()} disabled={savingName} className="p-1 text-indigo-600 hover:text-indigo-800 disabled:opacity-50">
                  {savingName ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </button>
                <button onClick={() => { setEditingName(false); setNameInput(team.name); }} className="p-1 text-gray-400 hover:text-gray-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-gray-900 dark:text-white">{team.name}</h3>
                {canEdit && (
                  <button onClick={() => setEditingName(true)} className="p-1 text-gray-300 hover:text-indigo-500 transition-colors" title="Rename team">
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>
          <p className="text-xs text-gray-400">Owner: <span className="font-mono">{team.ownerUsername}</span> · {team.memberUsernames.length} members</p>
          {deleteError && <p className="mt-1 text-xs text-red-500 dark:text-red-400">{deleteError}</p>}
        </div>
        <div className="flex items-center gap-2 ml-3 shrink-0">
          {canEdit && (
            <button
              onClick={() => setShowAddMember(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 dark:border-indigo-900/50 px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 transition-colors"
            >
              <UserPlus className="h-3.5 w-3.5" /> Add Member
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => { void handleDelete(); }}
              disabled={deleting}
              className="p-1.5 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
              title="Delete team"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-3">No members yet.</p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-white/5">
          {members.map((u) => (
            <div key={u.username} className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{u.username}</p>
                <p className="text-xs text-gray-400">{u.email}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <Shield className="h-3 w-3" />
                  <span className="font-mono">{u.roleName.split('_')[0]}</span>
                </div>
                {canEdit && u.username !== team.ownerUsername && (
                  <button
                    onClick={() => { void handleRemoveMember(u.username); }}
                    disabled={removing === u.username}
                    className="p-1 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                  >
                    {removing === u.username ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserMinus className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddMember && (
        <AddMemberModal
          team={team}
          allUsers={allUsers}
          onClose={() => setShowAddMember(false)}
          onUpdated={(updated) => { onUpdated(updated); setShowAddMember(false); }}
        />
      )}
    </div>
  );
}

export function TeamsSettingsPage() {
  const [teams, setTeams] = useState<SecurityTeam[]>([]);
  const [allUsers, setAllUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [isDevOps, setIsDevOps] = useState(false);
  const [isDomainOwner, setIsDomainOwner] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const role = await portalApi.getRole();
      setCurrentUsername(role.username);
      setIsDevOps(role.role === 'devops');
      setIsDomainOwner(role.roleName?.includes('DomainOwner') ?? false);

      const [teamsData, usersData] = await Promise.all([
        fetchApi<SecurityTeam[]>('/security/teams'),
        (role.role === 'devops' || role.roleName?.includes('DomainOwner'))
          ? fetchApi<PlatformUser[]>('/security/users')
          : Promise.resolve([] as PlatformUser[]),
      ]);
      setTeams(teamsData);
      setAllUsers(usersData);
    } catch (e) {
      console.error('[teams-settings] Failed to load:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const canCreateTeam = isDevOps || isDomainOwner;

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teams"
        actions={
          canCreateTeam ? (
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
            >
              <Plus className="h-4 w-4" /> Create Team
            </button>
          ) : undefined
        }
      />
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {isDevOps ? 'You can view and manage all teams.' : isDomainOwner ? 'You can create and manage your own team.' : 'Teams you belong to.'}
      </p>

      {teams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 py-12 text-center">
          <Users className="mx-auto mb-3 h-8 w-8 text-gray-300" />
          <p className="text-sm text-gray-500">No teams yet.</p>
          {canCreateTeam && (
            <button onClick={() => setShowCreate(true)} className="mt-3 text-sm text-indigo-600 hover:underline">Create the first team</button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {teams.map((team) => (
            <TeamCard
              key={team.teamId}
              team={team}
              allUsers={allUsers}
              canEdit={isDevOps || team.ownerUsername === currentUsername}
              canDelete={isDevOps}
              onUpdated={(updated) => setTeams((prev) => prev.map((t) => t.teamId === updated.teamId ? updated : t))}
              onDeleted={(id) => setTeams((prev) => prev.filter((t) => t.teamId !== id))}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateTeamModal
          onClose={() => setShowCreate(false)}
          onCreated={(t) => setTeams((prev) => [...prev, t])}
        />
      )}
    </div>
  );
}
