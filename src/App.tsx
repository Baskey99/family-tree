import { useCallback, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Cloud,
  FolderTree,
  GitFork,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  Moon,
  Search,
  Share2,
  Sun,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useFamilyStore } from './hooks/useFamilyStore';
import { useTheme } from './hooks/useTheme';
import { computeFamilyTreeLayout } from './lib/treeLayout';
import { getEffectiveAge } from './lib/familyUtils';
import {
  FamilyTreeCanvas,
  type FamilyTreeCanvasHandle,
} from './components/FamilyTreeCanvas';
import { MemberDetailsPanel } from './components/MemberDetailsPanel';
import { MemberFormModal } from './components/MemberFormModal';
import { DeleteMemberModal } from './components/DeleteMemberModal';
import { DirectoryView } from './components/DirectoryView';
import { LineagesView } from './components/LineagesView';
import { GenderIndicator } from './components/GenderBadge';
import { AuthModal, type AuthModalMode } from './components/AuthModal';
import { ShareTreeModal } from './components/ShareTreeModal';
import type { FamilyMember } from './types/family';

type PageTab = 'tree' | 'directory' | 'lineages';

export default function App() {
  const store = useFamilyStore();
  const { isDark, toggleTheme } = useTheme();

  const [activeTab, setActiveTab] = useState<PageTab>('tree');
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [highlightedMemberId, setHighlightedMemberId] = useState<string | null>(null);
  const [collapsedMemberIds, setCollapsedMemberIds] = useState<Set<string>>(() => new Set());

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  // Add / Edit / Delete modals
  const [formModal, setFormModal] = useState<{
    open: boolean;
    mode: 'add' | 'edit';
    editingMember: FamilyMember | null;
    defaultRelatedMemberId: string | null;
  }>({
    open: false,
    mode: 'add',
    editingMember: null,
    defaultRelatedMemberId: null,
  });

  const [deletingMember, setDeletingMember] = useState<FamilyMember | null>(null);
  const [authModal, setAuthModal] = useState<{ open: boolean; mode: AuthModalMode }>({
    open: false,
    mode: 'login',
  });
  const [shareModalTreeId, setShareModalTreeId] = useState<string | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);
  const [localToast, setLocalToast] = useState<{ text: string; isError?: boolean } | null>(null);

  const canvasRef = useRef<FamilyTreeCanvasHandle | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((text: string, isError = false) => {
    setLocalToast({ text, isError });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setLocalToast(null), 3500);
  }, []);

  // Owned vs shared trees for grouped selector
  const ownedTrees = useMemo(
    () => store.trees.filter((t) => !t.accessRole || t.accessRole === 'owner'),
    [store.trees]
  );
  const sharedTrees = useMemo(
    () => store.trees.filter((t) => t.accessRole === 'editor' || t.accessRole === 'viewer'),
    [store.trees]
  );

  const shareModalTree = useMemo(
    () => (shareModalTreeId ? store.trees.find((t) => t.id === shareModalTreeId) || null : null),
    [store.trees, shareModalTreeId]
  );

  const activeTreeCollabCount = useMemo(
    () =>
      store.activeTreeId && store.isOwnerOfActiveTree
        ? store.getCollaboratorsForTree(store.activeTreeId).length
        : 0,
    [store]
  );

  // Memoized hierarchical layout calculation
  const layout = useMemo(
    () =>
      computeFamilyTreeLayout(
        store.members,
        store.relationships,
        collapsedMemberIds
      ),
    [store.members, store.relationships, collapsedMemberIds]
  );

  const selectedMember = useMemo(
    () => store.members.find((m) => m.id === selectedMemberId) || null,
    [store.members, selectedMemberId]
  );

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return store.members
      .filter(
        (m) =>
          m.fullName.toLowerCase().includes(q) ||
          m.address.toLowerCase().includes(q) ||
          m.notes.toLowerCase().includes(q)
      )
      .slice(0, 10);
  }, [store.members, searchQuery]);

  const focusAndHighlightMember = useCallback((memberId: string, openInspector = false) => {
    setActiveTab('tree');
    setCollapsedMemberIds((prev) => {
      if (prev.size === 0) return prev;
      return new Set();
    });
    setSelectedMemberId(memberId);
    setHighlightedMemberId(memberId);
    if (openInspector) setDetailsOpen(true);

    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMemberId((cur) => (cur === memberId ? null : cur));
    }, 3000);

    window.setTimeout(() => {
      canvasRef.current?.focusMember(memberId);
    }, 60);
  }, []);

  const handleToggleCollapse = useCallback((memberId: string) => {
    setCollapsedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }, []);

  const handleOpenAddModal = useCallback(
    (relatedId: string | null = null) => {
      if (!store.canEditActiveTree) {
        showToast('You have view-only access to this shared family tree.', true);
        return;
      }
      setFormModal({
        open: true,
        mode: 'add',
        editingMember: null,
        defaultRelatedMemberId: relatedId,
      });
    },
    [store.canEditActiveTree, showToast]
  );

  const handleOpenEditModal = useCallback(
    (memberOrId: FamilyMember | string) => {
      if (!store.canEditActiveTree) {
        showToast('You have view-only access to this shared family tree.', true);
        return;
      }
      const member =
        typeof memberOrId === 'string'
          ? store.members.find((m) => m.id === memberOrId) || null
          : memberOrId;
      if (!member) return;
      setFormModal({
        open: true,
        mode: 'edit',
        editingMember: member,
        defaultRelatedMemberId: null,
      });
    },
    [store.canEditActiveTree, store.members, showToast]
  );

  const handleRequestDelete = useCallback(
    (memberOrId: FamilyMember | string) => {
      if (!store.canEditActiveTree) {
        showToast('You have view-only access to this shared family tree.', true);
        return;
      }
      const member =
        typeof memberOrId === 'string'
          ? store.members.find((m) => m.id === memberOrId) || null
          : memberOrId;
      if (member) setDeletingMember(member);
    },
    [store.canEditActiveTree, store.members, showToast]
  );

  const handleSwitchTree = useCallback(
    (treeId: string) => {
      store.selectTree(treeId);
      setSelectedMemberId(null);
      setDetailsOpen(false);
      setCollapsedMemberIds(new Set());
      setSearchQuery('');
      setActiveTab('tree');
    },
    [store]
  );

  const feedbackBanner = localToast
    ? localToast
    : store.errorMessage
      ? { text: store.errorMessage, isError: true }
      : store.syncStatus === 'saved' && store.statusMessage
        ? { text: store.statusMessage, isError: false }
        : null;

  return (
    <div className="h-[100dvh] flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden">
      {/* Top Navigation Bar — Clean 3-Zone Contract (Desktop/Tablet) + Compact Bar (Mobile) */}
      <header className="h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3.5 sm:px-6 flex items-center justify-between gap-3 sm:gap-6 shrink-0 z-30">
        {/* Zone 1: Single-line brand wordmark */}
        <button
          type="button"
          onClick={() => setActiveTab('tree')}
          className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
        >
          Kinship
        </button>

        {/* Zone 2: Clean single-line text navigation links (Tablet & Desktop; Mobile uses Bottom Nav) */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-6 lg:gap-7 text-sm font-medium"
        >
          {(
            [
              { id: 'tree', label: 'Family Tree' },
              { id: 'directory', label: 'Directory' },
              {
                id: 'lineages',
                label:
                  store.incomingInvites.length > 0
                    ? `Lineages (${store.incomingInvites.length})`
                    : 'Lineages',
              },
            ] as const
          ).map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`relative py-4 text-sm transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'text-slate-900 dark:text-slate-100 font-semibold'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {item.label}
                {active && (
                  <span
                    className="absolute bottom-0 inset-x-0 h-[2px] bg-slate-900 dark:bg-slate-100"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Theme Toggle + Account Sync + Primary Action */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={toggleTheme}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            {isDark ? (
              <Sun className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Moon className="w-4 h-4" aria-hidden="true" />
            )}
          </button>

          {store.authReady &&
            (store.user ? (
              <div className="flex items-center gap-1.5 pr-1">
                <span className="hidden md:inline text-xs text-slate-500 dark:text-slate-400 truncate max-w-[140px]">
                  {store.user.displayName || store.user.email}
                </span>
                <button
                  type="button"
                  onClick={() => void store.signOut()}
                  title="Sign out"
                  aria-label="Sign out"
                  className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <LogOut className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setAuthModal({ open: true, mode: 'login' })}
                  className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
                >
                  <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Login</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAuthModal({ open: true, mode: 'register' })}
                  className="hidden sm:inline-flex items-center px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Register
                </button>
              </div>
            ))}

          {store.canEditActiveTree ? (
            <button
              type="button"
              onClick={() => handleOpenAddModal(selectedMemberId)}
              className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-2 text-xs font-medium text-white dark:text-slate-900 bg-slate-900 dark:bg-slate-100 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors whitespace-nowrap shrink-0"
            >
              <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Add Family Member</span>
              <span className="sm:hidden">Add</span>
            </button>
          ) : (
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0 px-2">
              View only
            </span>
          )}
        </div>
      </header>

      {/* Incoming Family Tree Invitations Banner */}
      {store.incomingInvites.length > 0 && (
        <div className="bg-blue-50/90 dark:bg-blue-950/60 border-b border-blue-200/80 dark:border-blue-900/70 px-4 sm:px-6 py-2.5 shrink-0 z-20">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 text-xs text-slate-800 dark:text-slate-200 min-w-0">
              <Mail className="w-4 h-4 text-blue-700 dark:text-blue-400 shrink-0" aria-hidden="true" />
              <p className="truncate">
                <span className="font-semibold">{store.incomingInvites[0].ownerName}</span> invited
                you to{' '}
                <span className="font-semibold">"{store.incomingInvites[0].treeName}"</span> (
                {store.incomingInvites[0].role === 'editor' ? 'Can view & edit' : 'View only'})
                {store.incomingInvites.length > 1 && (
                  <span className="text-slate-600 dark:text-slate-400">
                    {' '}
                    · +{store.incomingInvites.length - 1} more
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={busyInviteId === store.incomingInvites[0].id}
                onClick={async () => {
                  const inv = store.incomingInvites[0];
                  setBusyInviteId(inv.id);
                  try {
                    await store.acceptInvite(inv);
                    setActiveTab('tree');
                  } catch (err) {
                    showToast(
                      err instanceof Error ? err.message : 'Could not accept invitation.',
                      true
                    );
                  } finally {
                    setBusyInviteId(null);
                  }
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white dark:text-slate-900 bg-slate-900 dark:bg-slate-100 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors whitespace-nowrap disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                Accept
              </button>
              <button
                type="button"
                disabled={busyInviteId === store.incomingInvites[0].id}
                onClick={async () => {
                  const inv = store.incomingInvites[0];
                  setBusyInviteId(inv.id);
                  try {
                    await store.declineInvite(inv.id);
                  } finally {
                    setBusyInviteId(null);
                  }
                }}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Page Router */}
      {activeTab === 'tree' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Family Tree Workspace Subheader */}
          <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3.5 sm:px-6 py-2.5 sm:py-3 flex flex-col md:flex-row md:items-center justify-between gap-2.5 sm:gap-3 shrink-0 z-20">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 min-w-0">
              <div className="hidden md:block mr-1">
                <h1 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100 leading-tight">
                  Family Tree
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {store.activeTree && !store.isOwnerOfActiveTree
                    ? `Shared by ${store.activeTree.ownerName || 'family owner'} · ${
                        store.activeTreeRole === 'editor' ? 'Can view & edit' : 'View only'
                      }`
                    : 'Build, share, and explore your family relationships.'}
                </p>
              </div>

              {store.trees.length > 0 && (
                <div className="flex items-center gap-2 w-full md:w-auto">
                  <label htmlFor="active-tree-select" className="sr-only">
                    Select active family tree
                  </label>
                  <select
                    id="active-tree-select"
                    value={store.activeTreeId}
                    onChange={(e) => handleSwitchTree(e.target.value)}
                    className="flex-1 min-w-0 md:flex-none px-2.5 py-2 md:py-1.5 text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 focus:border-slate-900 dark:focus:border-slate-400 md:max-w-[230px]"
                  >
                    {sharedTrees.length > 0 ? (
                      <>
                        {ownedTrees.length > 0 && (
                          <optgroup label="My Family Trees">
                            {ownedTrees.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="Shared With Me">
                          {sharedTrees.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} ({t.accessRole === 'editor' ? 'Edit' : 'View'})
                            </option>
                          ))}
                        </optgroup>
                      </>
                    ) : (
                      store.trees.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))
                    )}
                  </select>

                  {store.activeTree && store.isOwnerOfActiveTree && (
                    <button
                      type="button"
                      onClick={() => setShareModalTreeId(store.activeTree!.id)}
                      className="inline-flex items-center gap-1.5 px-3 md:px-2.5 py-2 md:py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>
                        {activeTreeCollabCount > 0 ? `Share (${activeTreeCollabCount})` : 'Share'}
                      </span>
                    </button>
                  )}
                </div>
              )}

              {/* Mobile shared-tree role note (quiet unboxed text) */}
              {store.activeTree && !store.isOwnerOfActiveTree && (
                <p className="md:hidden text-[11px] text-slate-500 dark:text-slate-400">
                  Shared by {store.activeTree.ownerName || 'family owner'} ·{' '}
                  {store.activeTreeRole === 'editor' ? 'Can view & edit' : 'View only'}
                </p>
              )}

              {/* Unboxed quiet metadata */}
              <div className="hidden xl:flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-mono tabular-nums">{store.members.length} members</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {layout.generations.length} generations
                </span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  {store.syncStatus === 'saving' ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                      Saving...
                    </>
                  ) : store.isCloudMode ? (
                    <>
                      <Cloud className="w-3 h-3 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                      Cloud synced
                    </>
                  ) : (
                    'Local workspace'
                  )}
                </span>
              </div>
            </div>

            {/* Live Search Family Members Autocomplete */}
            <div className="relative w-full md:w-64 lg:w-80 shrink-0">
              <Search
                className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => window.setTimeout(() => setSearchFocused(false), 180)}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search family members by name..."
                aria-label="Search family members by name"
                className="w-full pl-9 pr-8 py-2 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-800 focus:border-slate-900 dark:focus:border-slate-400 transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}

              {searchFocused && searchQuery.trim() && (
                <div className="absolute top-full left-0 right-0 mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden z-40">
                  {searchResults.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                      No members found matching "{searchQuery}"
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800 max-h-72 overflow-y-auto">
                      {searchResults.map((m) => {
                        const { age } = getEffectiveAge(m);
                        const gen = layout.memberGenerationMap.get(m.id);
                        return (
                          <li key={m.id}>
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setSearchQuery('');
                                setSearchFocused(false);
                                focusAndHighlightMember(m.id, true);
                              }}
                              className="w-full px-3.5 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                                  {m.fullName}
                                </p>
                                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                  <GenderIndicator gender={m.gender} compact />
                                  {age !== null && (
                                    <>
                                      <span>·</span>
                                      <span className="font-mono tabular-nums">{age} yrs</span>
                                    </>
                                  )}
                                  {m.address && (
                                    <>
                                      <span>·</span>
                                      <span className="truncate">{m.address}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              {gen !== undefined && (
                                <span className="text-[11px] font-mono tabular-nums text-slate-400 dark:text-slate-500 shrink-0">
                                  Gen {gen + 1}
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Canvas + Optional Details Inspector Split */}
          <div className="flex-1 flex min-h-0 relative">
            {store.loading ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 canvas-dot-grid">
                <Loader2 className="w-6 h-6 text-slate-600 dark:text-slate-400 animate-spin" aria-hidden="true" />
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {store.seedingCloud
                    ? 'Setting up sample family tree in Cloud Firestore...'
                    : 'Loading family tree...'}
                </p>
              </div>
            ) : (
              <FamilyTreeCanvas
                ref={canvasRef}
                treeName={store.activeTree?.name || 'Family Tree'}
                canEdit={store.canEditActiveTree}
                isDark={isDark}
                layout={layout}
                selectedMemberId={selectedMemberId}
                highlightedMemberId={highlightedMemberId}
                hasCollapsedBranches={collapsedMemberIds.size > 0}
                onSelectMember={(id) => {
                  setSelectedMemberId(id);
                  if (!id) setDetailsOpen(false);
                }}
                onViewDetails={(id) => {
                  setSelectedMemberId(id);
                  setDetailsOpen(true);
                }}
                onEditMember={(id) => handleOpenEditModal(id)}
                onAddRelative={(id) => handleOpenAddModal(id)}
                onDeleteMember={(id) => handleRequestDelete(id)}
                onToggleCollapse={handleToggleCollapse}
                onExpandAll={() => setCollapsedMemberIds(new Set())}
                onResetLayout={() => {
                  setCollapsedMemberIds(new Set());
                  setSelectedMemberId(null);
                  setHighlightedMemberId(null);
                }}
                onAddFirstMember={() => handleOpenAddModal(null)}
                onNotify={showToast}
              />
            )}

            {detailsOpen && selectedMember && (
              <MemberDetailsPanel
                member={selectedMember}
                members={store.members}
                relationships={store.relationships}
                generation={layout.memberGenerationMap.get(selectedMember.id)}
                canEdit={store.canEditActiveTree}
                onClose={() => setDetailsOpen(false)}
                onSelectMember={(id) => focusAndHighlightMember(id, true)}
                onEdit={(m) => handleOpenEditModal(m)}
                onAddRelative={(m) => handleOpenAddModal(m.id)}
                onDelete={(m) => handleRequestDelete(m)}
                onDeleteRelationship={(relId) => void store.deleteRelationship(relId)}
              />
            )}
          </div>
        </div>
      )}

      {activeTab === 'directory' && (
        <DirectoryView
          members={store.members}
          relationships={store.relationships}
          memberGenerationMap={layout.memberGenerationMap}
          canEdit={store.canEditActiveTree}
          onLocateOnTree={(id) => focusAndHighlightMember(id, false)}
          onViewDetails={(id) => focusAndHighlightMember(id, true)}
          onEdit={(m) => handleOpenEditModal(m)}
          onDelete={(m) => handleRequestDelete(m)}
          onAddMember={() => handleOpenAddModal(null)}
        />
      )}

      {activeTab === 'lineages' && (
        <LineagesView
          trees={store.trees}
          activeTreeId={store.activeTreeId}
          isCloudMode={store.isCloudMode}
          incomingInvites={store.incomingInvites}
          ownedTreeCollaborators={store.ownedTreeCollaborators}
          ownedTreeInvites={store.ownedTreeInvites}
          onSelectTree={handleSwitchTree}
          onShareTree={(treeId) => setShareModalTreeId(treeId)}
          onCreateTree={async (name, desc) => {
            const id = await store.createTree(name, desc);
            setActiveTab('tree');
            return id;
          }}
          onRenameTree={store.renameTree}
          onDeleteTree={store.deleteTree}
          onLeaveSharedTree={store.leaveSharedTree}
          onAcceptInvite={async (invite) => {
            await store.acceptInvite(invite);
            setActiveTab('tree');
          }}
          onDeclineInvite={store.declineInvite}
          onImportTemplate={async (templateId) => {
            const id = await store.importTemplateTree(templateId);
            if (id) setActiveTab('tree');
            return id;
          }}
        />
      )}

      {/* Mobile Bottom Navigation Bar (< md) */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden shrink-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 pb-safe z-30"
      >
        <div className="grid grid-cols-3 h-14">
          {(
            [
              { id: 'tree', label: 'Family Tree', icon: GitFork },
              { id: 'directory', label: 'Directory', icon: Users },
              { id: 'lineages', label: 'Lineages', icon: FolderTree },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            const showInviteCount = item.id === 'lineages' && store.incomingInvites.length > 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                  active
                    ? 'text-slate-900 dark:text-slate-100 font-semibold'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {active && (
                  <span
                    className="absolute top-0 inset-x-6 h-[2px] bg-slate-900 dark:bg-slate-100 rounded-full"
                    aria-hidden="true"
                  />
                )}
                <span className="relative">
                  <Icon className="w-4 h-4" aria-hidden="true" />
                  {showInviteCount && (
                    <span className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400" />
                  )}
                </span>
                <span>
                  {showInviteCount
                    ? `${item.label} (${store.incomingInvites.length})`
                    : item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Toast Feedback Banner */}
      {feedbackBanner && (
        <div
          role={feedbackBanner.isError ? 'alert' : 'status'}
          className={`fixed top-16 inset-x-3 sm:inset-x-auto sm:right-4 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-xl border shadow-lg text-xs font-medium sm:max-w-sm ${
            feedbackBanner.isError
              ? 'bg-rose-50 dark:bg-rose-950/90 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
              : 'bg-slate-900 dark:bg-slate-100 border-slate-800 dark:border-slate-200 text-white dark:text-slate-900'
          }`}
        >
          {feedbackBanner.isError ? (
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 dark:text-emerald-600" aria-hidden="true" />
          )}
          <span className="flex-1">{feedbackBanner.text}</span>
          <button
            type="button"
            onClick={() => {
              setLocalToast(null);
              store.clearError();
            }}
            aria-label="Dismiss notification"
            className="opacity-70 hover:opacity-100"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Add / Edit Family Member Modal */}
      <MemberFormModal
        open={formModal.open}
        mode={formModal.mode}
        editingMember={formModal.editingMember}
        defaultRelatedMemberId={formModal.defaultRelatedMemberId}
        members={store.members}
        relationships={store.relationships}
        onClose={() => setFormModal((prev) => ({ ...prev, open: false }))}
        onSubmitAdd={async (payload) => {
          const newId = await store.addMember(payload);
          focusAndHighlightMember(newId, false);
          return newId;
        }}
        onSubmitEdit={store.updateMember}
        onLinkExisting={store.linkExistingMembers}
      />

      {/* Delete Confirmation Modal */}
      <DeleteMemberModal
        member={deletingMember}
        members={store.members}
        relationships={store.relationships}
        onClose={() => setDeletingMember(null)}
        onConfirmDelete={async (id) => {
          await store.deleteMember(id);
          if (selectedMemberId === id) {
            setSelectedMemberId(null);
            setDetailsOpen(false);
          }
        }}
      />

      {/* Share Family Tree Modal */}
      <ShareTreeModal
        open={Boolean(shareModalTree)}
        tree={shareModalTree}
        isCloudMode={store.isCloudMode}
        currentUserEmail={store.user?.email || ''}
        currentUserName={store.user?.displayName || store.user?.email || 'You'}
        collaborators={
          shareModalTree ? store.getCollaboratorsForTree(shareModalTree.id) : []
        }
        pendingInvites={
          shareModalTree ? store.getInvitesForTree(shareModalTree.id) : []
        }
        onClose={() => setShareModalTreeId(null)}
        onOpenAuth={() => setAuthModal({ open: true, mode: 'login' })}
        onInviteMember={store.inviteFamilyMember}
        onUpdateCollaboratorRole={store.updateCollaboratorRole}
        onRevokeCollaborator={store.revokeCollaborator}
        onUpdateInviteRole={store.updateInviteRole}
        onCancelInvite={store.cancelInvite}
      />

      {/* Login, Register & Forgot Password Modal */}
      <AuthModal
        open={authModal.open}
        initialMode={authModal.mode}
        onClose={() => setAuthModal((prev) => ({ ...prev, open: false }))}
        onLogin={store.login}
        onRegister={store.register}
        onGoogleSignIn={store.signIn}
        onResetPassword={store.resetPassword}
      />
    </div>
  );
}
