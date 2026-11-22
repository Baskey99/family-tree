import { useMemo, useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import type { FamilyMember, FamilyRelationship } from '../types/family';
import { deriveMemberRelationships } from '../lib/familyUtils';

interface DeleteMemberModalProps {
  member: FamilyMember | null;
  members: FamilyMember[];
  relationships: FamilyRelationship[];
  onClose: () => void;
  onConfirmDelete: (memberId: string) => Promise<void>;
}

export function DeleteMemberModal({
  member,
  members,
  relationships,
  onClose,
  onConfirmDelete,
}: DeleteMemberModalProps) {
  const [deleting, setDeleting] = useState(false);

  const summary = useMemo(() => {
    if (!member) return null;
    const directRels = relationships.filter(
      (r) => r.personId === member.id || r.relatedPersonId === member.id
    );
    const derived = deriveMemberRelationships(member.id, members, relationships);
    return {
      directCount: directRels.length,
      parents: derived.parents.length,
      spouses: derived.spouses.length,
      children: derived.children.length,
      others: derived.others.length,
    };
  }, [member, members, relationships]);

  if (!member || !summary) return null;

  const handleConfirm = async () => {
    setDeleting(true);
    try {
      await onConfirmDelete(member.id);
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-modal-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/45 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white border-t sm:border border-slate-200 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-700 shrink-0">
              <AlertTriangle className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="delete-modal-title"
                className="font-display text-base font-semibold text-slate-900"
              >
                Delete {member.fullName}?
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">This action cannot be undone.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close confirmation dialog"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-6 pb-5 space-y-3 text-sm text-slate-600">
          {summary.directCount > 0 ? (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs space-y-1.5 leading-relaxed">
              <p className="font-semibold">
                {member.fullName} has {summary.directCount} active family connection
                {summary.directCount === 1 ? '' : 's'}:
              </p>
              <p>
                {[
                  summary.parents > 0 ? `${summary.parents} parent(s)` : null,
                  summary.spouses > 0 ? `${summary.spouses} spouse(s)` : null,
                  summary.children > 0 ? `${summary.children} child(ren)` : null,
                  summary.others > 0 ? `${summary.others} other link(s)` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-600">
              This member currently has no active connections to other family members.
            </p>
          )}

          <p className="text-xs text-slate-600 leading-relaxed">
            Deleting <strong>{member.fullName}</strong> will remove only this profile and its direct
            connector lines. <strong>No other family members or branches will be deleted</strong>,
            and remaining relatives will stay safely preserved in your tree.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2.5 px-5 sm:px-6 py-4 pb-safe bg-slate-50 border-t border-slate-200">
          <button
            type="button"
            disabled={deleting}
            onClick={onClose}
            className="px-4 py-2.5 sm:py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => void handleConfirm()}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 sm:py-2 text-xs font-medium text-white bg-rose-600 rounded-lg hover:bg-rose-700 transition-colors disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            {deleting ? 'Deleting...' : 'Delete Member'}
          </button>
        </div>
      </div>
    </div>
  );
}
