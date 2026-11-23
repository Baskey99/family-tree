import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  Check,
  CheckCircle2,
  Clock,
  GitMerge,
  Link2,
  Loader2,
  Lock,
  LogIn,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { GoogleIcon } from './GoogleIcon';
import { checkRateLimit } from '../lib/security';
import type {
  FamilyMember,
  FamilyTreeRecord,
  ShareRole,
  StoredRelationshipType,
  TreeConnection,
  TreeLinkDirection,
  TreeLinkRequest,
} from '../types/family';

type RelationshipChoiceId =
  | 'spouse'
  | 'parent_of_target'
  | 'child_of_target'
  | 'sibling'
  | 'cousin'
  | 'other';

const RELATIONSHIP_CHOICES: {
  id: RelationshipChoiceId;
  label: string;
  relationshipType: StoredRelationshipType;
  relationshipDirection: TreeLinkDirection;
  hint: string;
}[] = [
  {
    id: 'spouse',
    label: 'Spouse (Husband / Wife)',
    relationshipType: 'spouse',
    relationshipDirection: 'mutual',
    hint: 'Connects you and your spouse so both families see each other’s tree',
  },
  {
    id: 'parent_of_target',
    label: 'Parent (my member is parent of theirs)',
    relationshipType: 'parent_child',
    relationshipDirection: 'source_is_parent',
    hint: 'Places your selected member as the parent generation above theirs',
  },
  {
    id: 'child_of_target',
    label: 'Child (my member is child of theirs)',
    relationshipType: 'parent_child',
    relationshipDirection: 'target_is_parent',
    hint: 'Places your selected member as the child generation below theirs',
  },
  {
    id: 'sibling',
    label: 'Sibling (Brother / Sister)',
    relationshipType: 'sibling',
    relationshipDirection: 'mutual',
    hint: 'Connects siblings whose separate family trees are managed by different users',
  },
  {
    id: 'cousin',
    label: 'Cousin',
    relationshipType: 'cousin',
    relationshipDirection: 'mutual',
    hint: 'Connects extended cousin branches across accounts',
  },
  {
    id: 'other',
    label: 'Other / In-Law Relationship',
    relationshipType: 'other',
    relationshipDirection: 'mutual',
    hint: 'Add a custom label (e.g., Brother-in-law, Godparent, Family Friend)',
  },
];

export function formatTreeLinkRelationship(
  relationshipType: StoredRelationshipType,
  relationshipDirection: TreeLinkDirection,
  customLabel: string,
  perspective: 'source_to_target' | 'target_to_source' = 'source_to_target'
): string {
  if (relationshipType === 'spouse') return 'Spouse';
  if (relationshipType === 'sibling') return 'Sibling';
  if (relationshipType === 'cousin') return 'Cousin';
  if (relationshipType === 'parent_child') {
    if (perspective === 'source_to_target') {
      return relationshipDirection === 'target_is_parent' ? 'Child of' : 'Parent of';
    }
    return relationshipDirection === 'target_is_parent' ? 'Parent of' : 'Child of';
  }
  return customLabel.trim() || 'Connected Relative';
}

interface ConnectTreesModalProps {
  open: boolean;
  mode: 'send' | 'review';
  reviewRequest: TreeLinkRequest | null;
  ownedTrees: FamilyTreeRecord[];
  defaultTreeId: string;
  defaultMemberId: string | null;
  isCloudMode: boolean;
  currentUserId: string;
  treeConnections: TreeConnection[];
  outgoingLinkRequests: TreeLinkRequest[];
  onClose: () => void;
  onOpenAuth: () => void;
  onGoogleSignIn: () => Promise<void>;
  onFetchMembersForTree: (treeId: string) => Promise<FamilyMember[]>;
  onSendRequest: (params: {
    sourceTreeId: string;
    sourceMemberId: string;
    sourceMemberName: string;
    targetIdentifier: string;
    relationshipType: StoredRelationshipType;
    relationshipDirection: TreeLinkDirection;
    customLabel?: string;
    sourceGrantsRole: ShareRole;
    note?: string;
  }) => Promise<void>;
  onAcceptRequest: (params: {
    request: TreeLinkRequest;
    targetTreeId: string;
    targetMemberId: string;
    targetMemberName: string;
    targetGrantsRole: ShareRole;
  }) => Promise<void>;
  onDeclineRequest: (requestId: string) => Promise<void>;
  onCancelRequest: (requestId: string) => Promise<void>;
  onUpdatePermission: (connection: TreeConnection, newRoleForMyTree: ShareRole) => Promise<void>;
  onDisconnect: (connection: TreeConnection) => Promise<void>;
  onOpenCombinedView: (treeId: string) => void;
}

export function ConnectTreesModal({
  open,
  mode,
  reviewRequest,
  ownedTrees,
  defaultTreeId,
  defaultMemberId,
  isCloudMode,
  currentUserId,
  treeConnections,
  outgoingLinkRequests,
  onClose,
  onOpenAuth,
  onGoogleSignIn,
  onFetchMembersForTree,
  onSendRequest,
  onAcceptRequest,
  onDeclineRequest,
  onCancelRequest,
  onUpdatePermission,
  onDisconnect,
  onOpenCombinedView,
}: ConnectTreesModalProps) {
  const [selectedTreeId, setSelectedTreeId] = useState('');
  const [treeMembers, setTreeMembers] = useState<FamilyMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState('');

  // Send-request form fields
  const [relationshipChoice, setRelationshipChoice] = useState<RelationshipChoiceId>('spouse');
  const [customLabel, setCustomLabel] = useState('');
  const [targetIdentifier, setTargetIdentifier] = useState('');
  const [grantedRole, setGrantedRole] = useState<ShareRole>('viewer');
  const [note, setNote] = useState('');
  const [honeypot, setHoneypot] = useState('');

  // Status
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Initialize selected tree when modal opens
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSuccessMsg(null);
    setHoneypot('');
    setGrantedRole('viewer');

    const preferredTree =
      ownedTrees.find((t) => t.id === defaultTreeId)?.id || ownedTrees[0]?.id || '';
    setSelectedTreeId(preferredTree);
    setSelectedMemberId(defaultMemberId || '');
  }, [open, mode, reviewRequest?.id, defaultTreeId, defaultMemberId, ownedTrees]);

  // Load members for whichever owned tree is selected
  useEffect(() => {
    if (!open || !isCloudMode || !selectedTreeId) {
      setTreeMembers([]);
      return;
    }
    let cancelled = false;
    setLoadingMembers(true);
    onFetchMembersForTree(selectedTreeId)
      .then((list) => {
        if (cancelled) return;
        setTreeMembers(list);
        setSelectedMemberId((prev) => {
          if (prev && list.some((m) => m.id === prev)) return prev;
          if (
            mode === 'send' &&
            defaultMemberId &&
            selectedTreeId === defaultTreeId &&
            list.some((m) => m.id === defaultMemberId)
          ) {
            return defaultMemberId;
          }
          return list[0]?.id || '';
        });
      })
      .catch(() => {
        if (!cancelled) setTreeMembers([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingMembers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isCloudMode, selectedTreeId, mode, defaultTreeId, defaultMemberId, onFetchMembersForTree]);

  if (!open) return null;

  const isReviewMode = mode === 'review' && Boolean(reviewRequest);
  const activeChoice =
    RELATIONSHIP_CHOICES.find((c) => c.id === relationshipChoice) || RELATIONSHIP_CHOICES[0];

  const handleSendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (honeypot.trim().length > 0) {
      setError('Automated submission blocked.');
      return;
    }

    const rateCheck = checkRateLimit('tree_link');
    if (!rateCheck.allowed) {
      setError(
        rateCheck.message || 'Too many connection requests sent. Please wait before trying again.'
      );
      return;
    }

    if (!selectedTreeId) {
      setError('Select one of your family trees to connect.');
      return;
    }

    const chosenMember = treeMembers.find((m) => m.id === selectedMemberId);
    if (!chosenMember) {
      setError('Add at least one member to your family tree before connecting trees.');
      return;
    }

    if (!targetIdentifier.trim()) {
      setError('Enter the other user’s email address or username.');
      return;
    }

    if (activeChoice.relationshipType === 'other' && !customLabel.trim()) {
      setError('Please enter a label for this relationship (e.g., Brother-in-law).');
      return;
    }

    setSubmitting(true);
    try {
      await onSendRequest({
        sourceTreeId: selectedTreeId,
        sourceMemberId: chosenMember.id,
        sourceMemberName: chosenMember.fullName,
        targetIdentifier: targetIdentifier.trim(),
        relationshipType: activeChoice.relationshipType,
        relationshipDirection: activeChoice.relationshipDirection,
        customLabel: activeChoice.relationshipType === 'other' ? customLabel.trim() : '',
        sourceGrantsRole: grantedRole,
        note: note.trim(),
      });
      setTargetIdentifier('');
      setCustomLabel('');
      setNote('');
      setSuccessMsg(
        `Connection request sent! Once they approve and choose their access level, both trees will link automatically.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send tree connection request.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcceptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewRequest) return;
    setError(null);
    setSuccessMsg(null);

    if (!selectedTreeId) {
      setError('Select which of your family trees should connect.');
      return;
    }
    const chosenMember = treeMembers.find((m) => m.id === selectedMemberId);
    if (!chosenMember) {
      setError('Select the matching member in your family tree (add a member first if empty).');
      return;
    }

    setSubmitting(true);
    try {
      await onAcceptRequest({
        request: reviewRequest,
        targetTreeId: selectedTreeId,
        targetMemberId: chosenMember.id,
        targetMemberName: chosenMember.fullName,
        targetGrantsRole: grantedRole,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect family trees.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = async () => {
    if (!reviewRequest) return;
    setSubmitting(true);
    setError(null);
    try {
      await onDeclineRequest(reviewRequest.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not decline request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/45 dark:bg-black/70 backdrop-blur-[2px] p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-trees-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-xl bg-white dark:bg-slate-900 border-t sm:border border-slate-200 dark:border-slate-800 rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[92dvh] sm:max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile drag handle */}
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden shrink-0" aria-hidden="true">
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0 text-slate-700 dark:text-slate-200">
              <GitMerge className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="connect-trees-modal-title"
                className="font-display text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100 leading-tight"
              >
                {isReviewMode
                  ? 'Review & Approve Tree Connection'
                  : 'Connect Two Family Trees'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isReviewMode
                  ? 'Give mutual consent and choose whether they can view or edit your tree.'
                  : 'Link a member in your tree with another user’s tree (spouse, parent, sibling, or any relation).'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close connect trees modal"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-5">
          {!isCloudMode ? (
            <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-4 text-center">
              <div className="mx-auto w-11 h-11 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200">
                <Lock className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Sign in to connect family trees across accounts
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Connecting your family tree with a spouse or relative’s tree requires Cloud
                  accounts so both owners can grant explicit View or Edit consent.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAuth();
                  }}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white dark:text-slate-900 bg-slate-900 dark:bg-slate-100 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors"
                >
                  <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                  Login / Register
                </button>
                <button
                  type="button"
                  disabled={googleLoading}
                  onClick={async () => {
                    setGoogleLoading(true);
                    try {
                      await onGoogleSignIn();
                    } finally {
                      setGoogleLoading(false);
                    }
                  }}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                >
                  {googleLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <GoogleIcon className="w-3.5 h-3.5" />
                  )}
                  Continue with Google
                </button>
              </div>
            </div>
          ) : ownedTrees.length === 0 ? (
            <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-5 text-center space-y-2">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Create your own family tree first
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                To link two family trees together, you need at least one family tree that you own
                with at least one member inside it.
              </p>
            </div>
          ) : isReviewMode && reviewRequest ? (
            <form onSubmit={handleAcceptSubmit} className="space-y-4">
              {/* Summary of Incoming Request */}
              <div className="bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-900/70 rounded-xl p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-blue-900 dark:text-blue-200">
                    Connection Request from {reviewRequest.sourceOwnerName}
                  </span>
                  <span className="text-[11px] font-medium text-blue-700 dark:text-blue-300">
                    {formatTreeLinkRelationship(
                      reviewRequest.relationshipType,
                      reviewRequest.relationshipDirection,
                      reviewRequest.customLabel,
                      'source_to_target'
                    )}
                  </span>
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  <strong className="text-slate-900 dark:text-slate-100">
                    {reviewRequest.sourceOwnerName}
                  </strong>{' '}
                  ({reviewRequest.sourceOwnerEmail}) wants to connect{' '}
                  <strong className="text-slate-900 dark:text-slate-100">
                    {reviewRequest.sourceMemberName}
                  </strong>{' '}
                  in their tree{' '}
                  <strong className="text-slate-900 dark:text-slate-100">
                    “{reviewRequest.sourceTreeName}”
                  </strong>{' '}
                  with a member in your family tree.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-slate-600 dark:text-slate-400">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                  <span>
                    Access they are granting you on “{reviewRequest.sourceTreeName}”:{' '}
                    <strong className="text-slate-900 dark:text-slate-100">
                      {reviewRequest.sourceGrantsRole === 'editor'
                        ? 'Can view & edit'
                        : 'View only'}
                    </strong>
                  </span>
                </div>
                {reviewRequest.note && (
                  <p className="text-xs italic text-slate-600 dark:text-slate-400 border-l-2 border-blue-300 dark:border-blue-700 pl-2.5">
                    “{reviewRequest.note}”
                  </p>
                )}
              </div>

              {/* Pick Recipient's Tree & Member */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="review-target-tree"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Your Family Tree
                  </label>
                  <select
                    id="review-target-tree"
                    value={selectedTreeId}
                    onChange={(e) => setSelectedTreeId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:border-slate-900 dark:focus:border-slate-400"
                  >
                    {ownedTrees.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="review-target-member"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Member in Your Tree to Link
                  </label>
                  <select
                    id="review-target-member"
                    value={selectedMemberId}
                    disabled={loadingMembers || treeMembers.length === 0}
                    onChange={(e) => setSelectedMemberId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:border-slate-900 dark:focus:border-slate-400 disabled:opacity-60"
                  >
                    {loadingMembers ? (
                      <option value="">Loading members...</option>
                    ) : treeMembers.length === 0 ? (
                      <option value="">No members in this tree yet</option>
                    ) : (
                      treeMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.fullName}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              {/* Consent Role Granted Back */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Your Consent: Access you grant {reviewRequest.sourceOwnerName} on your tree
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {(
                    [
                      {
                        value: 'viewer',
                        title: 'View only',
                        desc: 'They can view your family tree and see it combined with theirs.',
                      },
                      {
                        value: 'editor',
                        title: 'Can view & edit',
                        desc: 'They can also add or update members in your family tree.',
                      },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setGrantedRole(opt.value)}
                      className={`text-left p-3 rounded-xl border transition-colors ${
                        grantedRole === opt.value
                          ? 'border-slate-900 dark:border-slate-100 bg-slate-50 dark:bg-slate-800/80 ring-1 ring-slate-900 dark:ring-slate-100'
                          : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {opt.title}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                        {opt.desc}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-lg px-3.5 py-2.5"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleDecline()}
                  className="px-4 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                >
                  Decline Request
                </button>
                <button
                  type="submit"
                  disabled={submitting || !selectedMemberId}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium text-white dark:text-slate-900 bg-slate-900 dark:bg-slate-100 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors disabled:opacity-50"
                >
                  {submitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  Approve & Connect Trees
                </button>
              </div>
            </form>
          ) : (
            <>
              {/* Send New Cross-Tree Connection Request Form */}
              <form onSubmit={handleSendSubmit} className="space-y-4">
                {/* Honeypot anti-bot field */}
                <div className="sr-only" aria-hidden="true">
                  <label htmlFor="tlink-hp">Leave blank</label>
                  <input
                    id="tlink-hp"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="connect-source-tree"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      Your Family Tree
                    </label>
                    <select
                      id="connect-source-tree"
                      value={selectedTreeId}
                      onChange={(e) => setSelectedTreeId(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:border-slate-900 dark:focus:border-slate-400"
                    >
                      {ownedTrees.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="connect-source-member"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      Member in Your Tree
                    </label>
                    <select
                      id="connect-source-member"
                      value={selectedMemberId}
                      disabled={loadingMembers || treeMembers.length === 0}
                      onChange={(e) => setSelectedMemberId(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:border-slate-900 dark:focus:border-slate-400 disabled:opacity-60"
                    >
                      {loadingMembers ? (
                        <option value="">Loading members...</option>
                      ) : treeMembers.length === 0 ? (
                        <option value="">No members in this tree yet</option>
                      ) : (
                        treeMembers.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.fullName}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>

                {/* Relationship Type */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="connect-relationship"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Relationship Between the Two Trees
                  </label>
                  <select
                    id="connect-relationship"
                    value={relationshipChoice}
                    onChange={(e) => setRelationshipChoice(e.target.value as RelationshipChoiceId)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:border-slate-900 dark:focus:border-slate-400"
                  >
                    {RELATIONSHIP_CHOICES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {activeChoice.hint}
                  </p>
                </div>

                {activeChoice.relationshipType === 'other' && (
                  <div className="space-y-1.5">
                    <label
                      htmlFor="connect-custom-label"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      Custom Relationship Label
                    </label>
                    <input
                      id="connect-custom-label"
                      type="text"
                      value={customLabel}
                      onChange={(e) => setCustomLabel(e.target.value)}
                      maxLength={80}
                      placeholder="e.g., Brother-in-law, Uncle, Family Friend"
                      className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                    />
                  </div>
                )}

                {/* Other User's Email or Username */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="connect-target-user"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Other Family Tree Owner’s Email or Username
                  </label>
                  <input
                    id="connect-target-user"
                    type="text"
                    required
                    value={targetIdentifier}
                    onChange={(e) => setTargetIdentifier(e.target.value)}
                    maxLength={254}
                    placeholder="e.g., wife@example.com or username"
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                </div>

                {/* Permission You Consent to Grant */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Access you grant them on your tree (once they accept)
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {(
                      [
                        {
                          value: 'viewer',
                          title: 'View only',
                          desc: 'They can view your tree and explore the combined family tree.',
                        },
                        {
                          value: 'editor',
                          title: 'Can view & edit',
                          desc: 'They can also add or update members in your family tree.',
                        },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setGrantedRole(opt.value)}
                        className={`text-left p-3 rounded-xl border transition-colors ${
                          grantedRole === opt.value
                            ? 'border-slate-900 dark:border-slate-100 bg-slate-50 dark:bg-slate-800/80 ring-1 ring-slate-900 dark:ring-slate-100'
                            : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {opt.title}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                          {opt.desc}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Optional Note */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="connect-note"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Optional Message
                  </label>
                  <input
                    id="connect-note"
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={300}
                    placeholder="e.g., Let’s link our two family trees together!"
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                </div>

                <div className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 rounded-lg px-3 py-2.5">
                  <ShieldCheck className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    Neither family tree is exposed until the other user explicitly approves your
                    request and chooses whether to grant you <strong>View only</strong> or{' '}
                    <strong>Can view & edit</strong> access on their tree.
                  </span>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-lg px-3.5 py-2.5"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                )}

                {successMsg && (
                  <div
                    role="status"
                    className="flex items-start gap-2 text-xs text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3.5 py-2.5"
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{successMsg}</span>
                  </div>
                )}

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={submitting || !selectedMemberId || !targetIdentifier.trim()}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-white dark:text-slate-900 bg-slate-900 dark:bg-slate-100 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors disabled:opacity-50"
                  >
                    {submitting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    Send Connection Request
                  </button>
                </div>
              </form>

              {/* Outgoing Pending Requests */}
              {outgoingLinkRequests.length > 0 && (
                <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-2.5">
                  <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                    Waiting for Approval ({outgoingLinkRequests.length})
                  </h3>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    {outgoingLinkRequests.map((req) => (
                      <li
                        key={req.id}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs bg-white dark:bg-slate-900"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                            {req.sourceMemberName} ({req.sourceTreeName}) → {req.targetEmail}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {formatTreeLinkRelationship(
                              req.relationshipType,
                              req.relationshipDirection,
                              req.customLabel
                            )}{' '}
                            · You offered{' '}
                            {req.sourceGrantsRole === 'editor' ? 'Edit access' : 'View only'}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={busyId === req.id}
                          onClick={async () => {
                            setBusyId(req.id);
                            try {
                              await onCancelRequest(req.id);
                            } finally {
                              setBusyId(null);
                            }
                          }}
                          className="px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 rounded-md hover:bg-rose-50 dark:hover:bg-rose-950/40 shrink-0 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Active Connected Trees */}
              {treeConnections.length > 0 && (
                <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-2.5">
                  <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <ArrowLeftRight className="w-3.5 h-3.5" aria-hidden="true" />
                    Connected Trees ({treeConnections.length})
                  </h3>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    {treeConnections.map((conn) => {
                      const isSource = conn.sourceOwnerId === currentUserId;
                      const myTreeId = isSource ? conn.sourceTreeId : conn.targetTreeId;
                      const myRoleGranted = isSource
                        ? conn.sourceGrantsRole
                        : conn.targetGrantsRole;
                      const theirRoleGranted = isSource
                        ? conn.targetGrantsRole
                        : conn.sourceGrantsRole;
                      const otherTreeName = isSource ? conn.targetTreeName : conn.sourceTreeName;
                      const isBusy = busyId === conn.id;

                      return (
                        <li
                          key={conn.id}
                          className="p-3.5 space-y-2 bg-white dark:bg-slate-900"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                                {conn.sourceMemberName} ({conn.sourceTreeName}) ↔{' '}
                                {conn.targetMemberName} ({conn.targetTreeName})
                              </p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                {formatTreeLinkRelationship(
                                  conn.relationshipType,
                                  conn.relationshipDirection,
                                  conn.customLabel
                                )}{' '}
                                · Your access to “{otherTreeName}”:{' '}
                                <span className="font-medium text-slate-700 dark:text-slate-200">
                                  {theirRoleGranted === 'editor' ? 'Can view & edit' : 'View only'}
                                </span>
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={async () => {
                                setBusyId(conn.id);
                                try {
                                  await onDisconnect(conn);
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                              title="Disconnect trees and revoke access"
                              aria-label={`Disconnect ${conn.sourceTreeName} and ${conn.targetTreeName}`}
                              className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 shrink-0 disabled:opacity-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
                              <span>On your tree:</span>
                              <select
                                disabled={isBusy}
                                value={myRoleGranted}
                                onChange={async (e) => {
                                  setBusyId(conn.id);
                                  try {
                                    await onUpdatePermission(conn, e.target.value as ShareRole);
                                  } finally {
                                    setBusyId(null);
                                  }
                                }}
                                className="px-2 py-1 text-[11px] font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-800 dark:text-slate-100"
                              >
                                <option value="viewer">View only</option>
                                <option value="editor">Can view & edit</option>
                              </select>
                            </label>

                            <button
                              type="button"
                              onClick={() => {
                                onOpenCombinedView(myTreeId);
                                onClose();
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-md transition-colors"
                            >
                              <GitMerge className="w-3 h-3" aria-hidden="true" />
                              Open Combined View
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
