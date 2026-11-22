import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Lock,
  LogIn,
  Mail,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type {
  FamilyTreeRecord,
  ShareRole,
  TreeInvite,
  TreeMembership,
} from '../types/family';

interface ShareTreeModalProps {
  open: boolean;
  tree: FamilyTreeRecord | null;
  isCloudMode: boolean;
  currentUserEmail: string;
  currentUserName: string;
  collaborators: TreeMembership[];
  pendingInvites: TreeInvite[];
  onClose: () => void;
  onOpenAuth: () => void;
  onInviteMember: (treeId: string, identifier: string, role: ShareRole) => Promise<void>;
  onUpdateCollaboratorRole: (membershipId: string, role: ShareRole) => Promise<void>;
  onRevokeCollaborator: (membershipId: string) => Promise<void>;
  onUpdateInviteRole: (inviteId: string, role: ShareRole) => Promise<void>;
  onCancelInvite: (inviteId: string) => Promise<void>;
}

export function ShareTreeModal({
  open,
  tree,
  isCloudMode,
  currentUserEmail,
  currentUserName,
  collaborators,
  pendingInvites,
  onClose,
  onOpenAuth,
  onInviteMember,
  onUpdateCollaboratorRole,
  onRevokeCollaborator,
  onUpdateInviteRole,
  onCancelInvite,
}: ShareTreeModalProps) {
  const [identifier, setIdentifier] = useState('');
  const [role, setRole] = useState<ShareRole>('viewer');
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!open || !tree) return null;

  const isOwner = !tree.accessRole || tree.accessRole === 'owner';

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    const trimmed = identifier.trim();
    if (!trimmed) {
      setError('Enter your family member’s email address or username.');
      return;
    }

    setSubmitting(true);
    try {
      await onInviteMember(tree.id, trimmed, role);
      setIdentifier('');
      setSuccessMsg(
        `Invitation sent to ${trimmed} (${role === 'editor' ? 'Can view & edit' : 'View only'}).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send invitation.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/45 dark:bg-black/70 backdrop-blur-[2px] p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-tree-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg bg-white dark:bg-slate-900 border-t sm:border border-slate-200 dark:border-slate-800 rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[92dvh] sm:max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile sheet handle */}
        <div className="flex justify-center pt-2.5 pb-0.5 sm:hidden shrink-0" aria-hidden="true">
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        {/* Header */}
        <div className="px-5 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h2
              id="share-tree-modal-title"
              className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100 truncate"
            >
              Share "{tree.name}"
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Invite family members and control who can view or edit this tree.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share dialog"
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 pb-safe overflow-y-auto space-y-5 sm:space-y-6">
          {/* Family-Only Privacy Notice */}
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            <Lock className="w-4 h-4 text-slate-700 dark:text-slate-300 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-100">Private to your family</p>
              <p className="mt-0.5">
                Only you and invited family members listed below can view this family tree. Other
                users cannot see or search your family details.
              </p>
            </div>
          </div>

          {!isCloudMode ? (
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 text-center space-y-3">
              <div className="mx-auto w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300">
                <Users className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Sign in to share with family members
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Create a free account or sign in to sync your family tree securely and invite
                  relatives with View or Edit permissions.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAuth();
                }}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white dark:text-slate-900 bg-slate-900 dark:bg-slate-100 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors"
              >
                <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                Login or Register
              </button>
            </div>
          ) : !isOwner ? (
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-xs text-slate-600 dark:text-slate-400 space-y-1">
              <p className="font-medium text-slate-900 dark:text-slate-100">Managed by tree owner</p>
              <p>
                This tree is shared with you by{' '}
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  {tree.ownerName || 'the family owner'}
                </span>{' '}
                with{' '}
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  {tree.accessRole === 'editor' ? 'Editor (View & Edit)' : 'Viewer (View only)'}
                </span>{' '}
                access. Only the tree owner can invite or remove family members.
              </p>
            </div>
          ) : (
            <>
              {/* Invite Form */}
              <form onSubmit={handleInvite} className="space-y-3">
                <label
                  htmlFor="share-invite-identifier"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Invite a family member
                </label>

                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Mail
                      className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      id="share-invite-identifier"
                      type="text"
                      value={identifier}
                      onChange={(e) => {
                        setIdentifier(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder="Email address or username"
                      className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-slate-900 dark:focus:border-slate-400"
                    />
                  </div>

                  <select
                    aria-label="Access permission"
                    value={role}
                    onChange={(e) => setRole(e.target.value as ShareRole)}
                    className="px-3 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 focus:border-slate-900 dark:focus:border-slate-400 shrink-0"
                  >
                    <option value="viewer">Viewer (View only)</option>
                    <option value="editor">Editor (Can edit)</option>
                  </select>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {role === 'editor'
                      ? 'Editors can add, edit, and remove family members and links.'
                      : 'Viewers can browse, search, and export the tree without making edits.'}
                  </p>
                  <button
                    type="submit"
                    disabled={submitting || !identifier.trim()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white dark:text-slate-900 bg-slate-900 dark:bg-slate-100 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                    {submitting ? 'Sending...' : 'Send Invite'}
                  </button>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-200"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                )}

                {successMsg && (
                  <div
                    role="status"
                    className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-200"
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{successMsg}</span>
                  </div>
                )}
              </form>

              {/* People with Access */}
              <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" aria-hidden="true" />
                    People with access ({collaborators.length + 1})
                  </h3>
                </div>

                <ul className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
                  {/* Owner Row */}
                  <li className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {currentUserName || 'You'}{' '}
                        <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                          (You)
                        </span>
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {currentUserEmail}
                      </p>
                    </div>
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0">
                      Owner
                    </span>
                  </li>

                  {/* Accepted Collaborators */}
                  {collaborators.map((member) => {
                    const isBusy = busyId === member.id;
                    return (
                      <li
                        key={member.id}
                        className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                            {member.userName || member.userEmail}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            {member.userEmail}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <select
                            aria-label={`Change role for ${member.userEmail}`}
                            disabled={isBusy}
                            value={member.role}
                            onChange={async (e) => {
                              setError(null);
                              setBusyId(member.id);
                              try {
                                await onUpdateCollaboratorRole(
                                  member.id,
                                  e.target.value as ShareRole
                                );
                              } catch (err) {
                                setError(
                                  err instanceof Error ? err.message : 'Could not update role.'
                                );
                              } finally {
                                setBusyId(null);
                              }
                            }}
                            className="px-2.5 py-1.5 text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 disabled:opacity-50"
                          >
                            <option value="viewer">Viewer</option>
                            <option value="editor">Editor</option>
                          </select>

                          <button
                            type="button"
                            disabled={isBusy}
                            title="Revoke access"
                            aria-label={`Revoke access for ${member.userEmail}`}
                            onClick={async () => {
                              setError(null);
                              setBusyId(member.id);
                              try {
                                await onRevokeCollaborator(member.id);
                              } catch (err) {
                                setError(
                                  err instanceof Error ? err.message : 'Could not revoke access.'
                                );
                              } finally {
                                setBusyId(null);
                              }
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors disabled:opacity-50"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Pending Invitations */}
              {pendingInvites.length > 0 && (
                <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                    Pending invitations ({pendingInvites.length})
                  </h3>

                  <ul className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
                    {pendingInvites.map((invite) => {
                      const isBusy = busyId === invite.id;
                      return (
                        <li
                          key={invite.id}
                          className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                              {invite.inviteeEmail}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              Waiting for acceptance · Invited{' '}
                              {new Date(invite.createdAt).toLocaleDateString()}
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <select
                              aria-label={`Change invite role for ${invite.inviteeEmail}`}
                              disabled={isBusy}
                              value={invite.role}
                              onChange={async (e) => {
                                setError(null);
                                setBusyId(invite.id);
                                try {
                                  await onUpdateInviteRole(
                                    invite.id,
                                    e.target.value as ShareRole
                                  );
                                } catch (err) {
                                  setError(
                                    err instanceof Error
                                      ? err.message
                                      : 'Could not update invite role.'
                                  );
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                              className="px-2.5 py-1.5 text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 disabled:opacity-50"
                            >
                              <option value="viewer">Viewer</option>
                              <option value="editor">Editor</option>
                            </select>

                            <button
                              type="button"
                              disabled={isBusy}
                              title="Cancel invitation"
                              aria-label={`Cancel invitation for ${invite.inviteeEmail}`}
                              onClick={async () => {
                                setError(null);
                                setBusyId(invite.id);
                                try {
                                  await onCancelInvite(invite.id);
                                } catch (err) {
                                  setError(
                                    err instanceof Error
                                      ? err.message
                                      : 'Could not cancel invitation.'
                                  );
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors disabled:opacity-50"
                            >
                              <Trash2 className="w-4 h-4" aria-hidden="true" />
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
