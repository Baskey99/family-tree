import React, { useMemo, useState } from 'react';
import {
  Check,
  FolderPlus,
  GitFork,
  Import,
  LogOut,
  Mail,
  Pencil,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { SEED_FAMILY_TREES } from '../data/seedFamilyTrees';
import type { FamilyTreeRecord, TreeInvite, TreeMembership } from '../types/family';

interface LineagesViewProps {
  trees: FamilyTreeRecord[];
  activeTreeId: string;
  isCloudMode: boolean;
  incomingInvites: TreeInvite[];
  ownedTreeCollaborators: TreeMembership[];
  ownedTreeInvites: TreeInvite[];
  onSelectTree: (treeId: string) => void;
  onShareTree: (treeId: string) => void;
  onCreateTree: (name: string, description: string) => Promise<string>;
  onRenameTree: (treeId: string, name: string, description: string) => Promise<void>;
  onDeleteTree: (treeId: string) => Promise<void>;
  onLeaveSharedTree: (membershipId: string) => Promise<void>;
  onAcceptInvite: (invite: TreeInvite) => Promise<void>;
  onDeclineInvite: (inviteId: string) => Promise<void>;
  onImportTemplate: (templateId: string) => Promise<string | null>;
}

export function LineagesView({
  trees,
  activeTreeId,
  isCloudMode,
  incomingInvites,
  ownedTreeCollaborators,
  ownedTreeInvites,
  onSelectTree,
  onShareTree,
  onCreateTree,
  onRenameTree,
  onDeleteTree,
  onLeaveSharedTree,
  onAcceptInvite,
  onDeclineInvite,
  onImportTemplate,
}: LineagesViewProps) {
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const [confirmLeaveId, setConfirmLeaveId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const ownedTrees = useMemo(
    () => trees.filter((t) => !t.accessRole || t.accessRole === 'owner'),
    [trees]
  );

  const sharedTrees = useMemo(
    () => trees.filter((t) => t.accessRole === 'editor' || t.accessRole === 'viewer'),
    [trees]
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await onCreateTree(newName, newDesc);
      setNewName('');
      setNewDesc('');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveRename = async (treeId: string) => {
    if (!editName.trim()) return;
    await onRenameTree(treeId, editName, editDesc);
    setEditingId(null);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-6 sm:space-y-8">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
            Family Lineages
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Create private family trees, share view or edit access with family members, or open
            lineages shared with you.
          </p>
        </div>

        {/* Pending Invitations Received */}
        {incomingInvites.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" aria-hidden="true" />
              Pending Invitations ({incomingInvites.length})
            </h2>

            <div className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
              {incomingInvites.map((invite) => {
                const isBusy = busyInviteId === invite.id;
                return (
                  <div
                    key={invite.id}
                    className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {invite.treeName}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Invited by{' '}
                        <span className="font-medium text-slate-700 dark:text-slate-200">
                          {invite.ownerName}
                        </span>{' '}
                        · Access:{' '}
                        <span className="font-medium text-slate-700 dark:text-slate-200">
                          {invite.role === 'editor' ? 'Editor (Can view & edit)' : 'Viewer (View only)'}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={async () => {
                          setBusyInviteId(invite.id);
                          try {
                            await onAcceptInvite(invite);
                          } finally {
                            setBusyInviteId(null);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white dark:text-slate-900 bg-slate-900 dark:bg-slate-100 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={async () => {
                          setBusyInviteId(invite.id);
                          try {
                            await onDeclineInvite(invite.id);
                          } finally {
                            setBusyInviteId(null);
                          }
                        }}
                        className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                        Decline
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Owned Trees */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              My Family Trees ({ownedTrees.length})
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {isCloudMode ? 'Private · Synced to Cloud Firestore' : 'Stored locally in this browser'}
            </span>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
            {ownedTrees.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                No family trees created yet. Create a blank tree below or import the sample family
                template.
              </div>
            ) : (
              ownedTrees.map((tree) => {
                const isActive = tree.id === activeTreeId;
                const isEditing = editingId === tree.id;
                const isDeleting = confirmDeleteId === tree.id;
                const collabCount = ownedTreeCollaborators.filter((c) => c.treeId === tree.id).length;
                const pendingCount = ownedTreeInvites.filter((i) => i.treeId === tree.id).length;

                return (
                  <div
                    key={tree.id}
                    className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    {isEditing ? (
                      <div className="flex-1 space-y-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          maxLength={120}
                          className="w-full px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                        />
                        <input
                          type="text"
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          maxLength={400}
                          placeholder="Short description..."
                          className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                        />
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => void handleSaveRename(tree.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-white"
                          >
                            <Check className="w-3.5 h-3.5" aria-hidden="true" />
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {tree.name}
                          </h3>
                          {isActive && (
                            <span className="text-xs font-medium text-blue-700 dark:text-blue-400">
                              · Active
                            </span>
                          )}
                        </div>
                        {tree.description && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            {tree.description}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400 dark:text-slate-500 mt-1.5">
                          <span className="font-mono tabular-nums">
                            Updated {new Date(tree.updatedAt).toLocaleDateString()}
                          </span>
                          <span>·</span>
                          <span>
                            {collabCount > 0
                              ? `Shared with ${collabCount} family ${collabCount === 1 ? 'member' : 'members'}`
                              : 'Only you'}
                          </span>
                          {pendingCount > 0 && (
                            <>
                              <span>·</span>
                              <span className="text-slate-500 dark:text-slate-400">
                                {pendingCount} pending
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {!isEditing && (
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {isDeleting ? (
                          <>
                            <span className="text-xs text-rose-700 dark:text-rose-400 font-medium mr-1">
                              Delete tree?
                            </span>
                            <button
                              type="button"
                              onClick={async () => {
                                await onDeleteTree(tree.id);
                                setConfirmDeleteId(null);
                              }}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-rose-600 rounded-lg hover:bg-rose-700"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => onSelectTree(tree.id)}
                              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                                isActive
                                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                                  : 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white'
                              }`}
                            >
                              <GitFork className="w-3.5 h-3.5" aria-hidden="true" />
                              {isActive ? 'Open Canvas' : 'Switch to Tree'}
                            </button>
                            <button
                              type="button"
                              onClick={() => onShareTree(tree.id)}
                              title="Share with family members"
                              aria-label={`Share ${tree.name}`}
                              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
                            >
                              <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
                              Share
                            </button>
                            <button
                              type="button"
                              title="Rename Tree"
                              aria-label={`Rename ${tree.name}`}
                              onClick={() => {
                                setEditingId(tree.id);
                                setEditName(tree.name);
                                setEditDesc(tree.description);
                              }}
                              className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                              <Pencil className="w-4 h-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              title="Delete Tree"
                              aria-label={`Delete ${tree.name}`}
                              onClick={() => setConfirmDeleteId(tree.id)}
                              className="p-2 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Shared With Me */}
        {isCloudMode && (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Shared With Me ({sharedTrees.length})
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Trees other family members invited you to
              </span>
            </div>

            <div className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
              {sharedTrees.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  No family trees have been shared with your account yet. When a relative invites
                  your email or username, it will appear here.
                </div>
              ) : (
                sharedTrees.map((tree) => {
                  const isActive = tree.id === activeTreeId;
                  const isLeaving = confirmLeaveId === tree.id;
                  return (
                    <div
                      key={tree.id}
                      className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {tree.name}
                          </h3>
                          {isActive && (
                            <span className="text-xs font-medium text-blue-700 dark:text-blue-400">
                              · Active
                            </span>
                          )}
                        </div>
                        {tree.description && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            {tree.description}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                          <span>Shared by {tree.ownerName || 'Family Owner'}</span>
                          <span className="text-slate-300 dark:text-slate-600">·</span>
                          <span className="font-medium text-slate-700 dark:text-slate-200">
                            {tree.accessRole === 'editor'
                              ? 'Editor (Can view & edit)'
                              : 'Viewer (View only)'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isLeaving && tree.membershipId ? (
                          <>
                            <span className="text-xs text-rose-700 dark:text-rose-400 font-medium mr-1">
                              Leave tree?
                            </span>
                            <button
                              type="button"
                              onClick={async () => {
                                await onLeaveSharedTree(tree.membershipId!);
                                setConfirmLeaveId(null);
                              }}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-rose-600 rounded-lg hover:bg-rose-700"
                            >
                              Leave
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmLeaveId(null)}
                              className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => onSelectTree(tree.id)}
                              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                                isActive
                                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                                  : 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white'
                              }`}
                            >
                              <GitFork className="w-3.5 h-3.5" aria-hidden="true" />
                              {isActive ? 'Open Canvas' : 'Open Tree'}
                            </button>
                            {tree.membershipId && (
                              <button
                                type="button"
                                title="Leave shared tree"
                                aria-label={`Leave ${tree.name}`}
                                onClick={() => setConfirmLeaveId(tree.id)}
                                className="p-2 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                              >
                                <LogOut className="w-4 h-4" aria-hidden="true" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        )}

        {/* Create Blank Tree */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
          <form
            onSubmit={handleCreate}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-center gap-2.5">
              <FolderPlus className="w-5 h-5 text-slate-700 dark:text-slate-300" aria-hidden="true" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Create Blank Family Tree
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Start a clean workspace to map a new branch or side of the family from scratch.
            </p>
            <div className="space-y-3">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={120}
                required
                placeholder="Tree name (e.g., Maternal Lineage)"
                className="w-full px-3.5 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-slate-900 dark:focus:border-slate-400"
              />
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                maxLength={400}
                placeholder="Optional description..."
                className="w-full px-3.5 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-slate-900 dark:focus:border-slate-400"
              />
            </div>
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="px-4 py-2 text-xs font-medium text-white dark:text-slate-900 bg-slate-900 dark:bg-slate-100 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Blank Tree'}
            </button>
          </form>

          {/* Sample Family Template */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <Import className="w-5 h-5 text-slate-700 dark:text-slate-300" aria-hidden="true" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Sample Family Template
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Import a ready-made 3-generation sample family tree to explore relationships, layout,
              and sharing.
            </p>
            <div className="space-y-3">
              {SEED_FAMILY_TREES.map((seed) => (
                <div
                  key={seed.id}
                  className="flex items-center justify-between gap-3 py-2.5 border-t border-slate-100 dark:border-slate-800 first:border-t-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {seed.name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      {seed.members.length} members · {seed.relationships.length} links
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={importingId !== null}
                    onClick={async () => {
                      setImportingId(seed.id);
                      try {
                        await onImportTemplate(seed.id);
                      } finally {
                        setImportingId(null);
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    {importingId === seed.id ? 'Importing...' : 'Import Copy'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
