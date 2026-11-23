import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Calendar,
  FileText,
  GitMerge,
  Link2,
  MapPin,
  Pencil,
  Trash2,
  Unlink,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  FamilyMember,
  FamilyRelationship,
  RelatedMemberItem,
  TreeConnection,
} from '../types/family';
import {
  deriveMemberRelationships,
  formatDateReadable,
  getEffectiveAge,
  getInitials,
} from '../lib/familyUtils';
import { sanitizeImageUrl } from '../lib/security';
import { GenderIndicator } from './GenderBadge';
import { formatTreeLinkRelationship } from './ConnectTreesModal';

interface MemberDetailsPanelProps {
  member: FamilyMember | null;
  members: FamilyMember[];
  relationships: FamilyRelationship[];
  generation: number | undefined;
  activeTreeId?: string;
  isOwnerOfActiveTree?: boolean;
  isCombinedView?: boolean;
  memberConnections?: TreeConnection[];
  canEdit?: boolean;
  onClose: () => void;
  onSelectMember: (memberId: string) => void;
  onEdit: (member: FamilyMember) => void;
  onAddRelative: (member: FamilyMember) => void;
  onDelete: (member: FamilyMember) => void;
  onDeleteRelationship: (relationshipId: string) => void;
  onOpenConnectModal?: (memberId: string) => void;
  onJumpToConnectedTree?: (treeId: string, openCombined?: boolean) => void;
}

function RelationGroup({
  title,
  items,
  canEdit,
  onSelect,
  onUnlink,
}: {
  title: string;
  items: RelatedMemberItem[];
  canEdit: boolean;
  onSelect: (id: string) => void;
  onUnlink: (relId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wide">
        {title} ({items.length})
      </h4>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 overflow-hidden">
        {items.map((item) => {
          const isMale = item.member.gender === 'male';
          return (
            <li
              key={`${title}_${item.member.id}_${item.relationshipId || 'derived'}`}
              className="flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors"
            >
              <button
                type="button"
                onClick={() => onSelect(item.member.id)}
                className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
              >
                <span
                  className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold ${
                    isMale
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 ring-1 ring-blue-200 dark:ring-blue-800/70'
                      : 'bg-pink-50 dark:bg-pink-950/60 text-pink-700 dark:text-pink-300 ring-1 ring-pink-200 dark:ring-pink-800/70'
                  }`}
                >
                  {getInitials(item.member.fullName)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {item.member.fullName}
                  </span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {item.label}
                    {item.relationshipId?.startsWith('bridge_')
                      ? ' · Cross-tree link'
                      : item.isDerived
                        ? ' · Derived'
                        : ''}
                  </span>
                </span>
              </button>

              {canEdit &&
                item.relationshipId &&
                !item.isDerived &&
                !item.relationshipId.startsWith('bridge_') &&
                !item.relationshipId.includes('::') && (
                  <button
                    type="button"
                    title="Remove connection"
                    aria-label={`Remove connection to ${item.member.fullName}`}
                    onClick={() => onUnlink(item.relationshipId!)}
                    className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors shrink-0"
                  >
                    <Unlink className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function MemberDetailsPanel({
  member,
  members,
  relationships,
  generation,
  activeTreeId = '',
  isOwnerOfActiveTree = false,
  isCombinedView = false,
  memberConnections = [],
  canEdit = true,
  onClose,
  onSelectMember,
  onEdit,
  onAddRelative,
  onDelete,
  onDeleteRelationship,
  onOpenConnectModal,
  onJumpToConnectedTree,
}: MemberDetailsPanelProps) {
  const [imgError, setImgError] = useState(false);

  const derived = useMemo(() => {
    if (!member) return null;
    return deriveMemberRelationships(member.id, members, relationships);
  }, [member, members, relationships]);

  if (!member || !derived) return null;

  const isExternalTreeMember = Boolean(activeTreeId && member.treeId !== activeTreeId);
  const effectiveCanEdit = canEdit && !isExternalTreeMember;
  const isMale = member.gender === 'male';
  const { age, source } = getEffectiveAge(member);
  const totalConnections =
    derived.parents.length +
    derived.spouses.length +
    derived.children.length +
    derived.siblings.length +
    derived.cousins.length +
    derived.grandparents.length +
    derived.grandchildren.length +
    derived.others.length;

  return (
    <>
      {/* Backdrop scrim on mobile & tablet */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-slate-900/35 dark:bg-black/60 backdrop-blur-[1px] lg:hidden"
      />

      <aside
        aria-label="Member details"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] rounded-t-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:rounded-none sm:w-[380px] bg-white dark:bg-slate-900 border-t sm:border-t-0 sm:border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col lg:static lg:shadow-none lg:z-10 lg:w-[380px] lg:shrink-0"
      >
        {/* Mobile sheet drag handle indicator */}
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden shrink-0" aria-hidden="true">
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        {/* Top Bar */}
        <div className="flex items-center justify-between px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Member Profile</p>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
              {member.fullName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close member details"
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
        {/* Profile Header */}
        <div className="flex items-start gap-4">
          <div
            className={`w-16 h-16 rounded-2xl shrink-0 overflow-hidden flex items-center justify-center text-lg font-semibold ring-1 ${
              isMale
                ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-800/70'
                : 'bg-pink-50 dark:bg-pink-950/60 text-pink-700 dark:text-pink-300 ring-pink-200 dark:ring-pink-800/70'
            }`}
          >
            {sanitizeImageUrl(member.photoUrl) && !imgError ? (
              <img
                src={sanitizeImageUrl(member.photoUrl)}
                alt={member.fullName}
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <span>{getInitials(member.fullName)}</span>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-1.5">
            <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100 leading-tight break-words">
              {member.fullName}
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <GenderIndicator gender={member.gender} />
              {generation !== undefined && (
                <>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                    ·
                  </span>
                  <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    Generation {generation + 1}
                  </span>
                </>
              )}
              {age !== null && (
                <>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                    ·
                  </span>
                  <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200 font-medium">
                    {age} yrs
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        {isExternalTreeMember ? (
          <div className="bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-900/70 rounded-xl p-3.5 space-y-2.5">
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              Belongs to connected tree{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                “{member.originTreeName || 'Connected Family Tree'}”
              </strong>{' '}
              ({member.originTreeRole === 'editor' ? 'Can view & edit' : 'View only'}).
            </p>
            {onJumpToConnectedTree && (
              <button
                type="button"
                onClick={() => onJumpToConnectedTree(member.treeId, false)}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white dark:text-slate-900 bg-slate-900 dark:bg-slate-100 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors"
              >
                <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                Open “{member.originTreeName || 'Connected Tree'}”
                {member.originTreeRole === 'editor' ? ' to Edit' : ''}
              </button>
            )}
          </div>
        ) : effectiveCanEdit ? (
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => onAddRelative(member)}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-medium bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
              Add Relative
            </button>
            <button
              type="button"
              onClick={() => onEdit(member)}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-medium bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              Edit Profile
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 rounded-lg px-3.5 py-2.5">
            View-only access · Ask the family tree owner for Editor access to make changes.
          </p>
        )}

        {/* Personal Details */}
        <div className="border-t border-slate-100 dark:border-slate-800 pt-5 space-y-3">
          <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wide">Details</h4>

          <dl className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <Calendar className="w-4 h-4 text-slate-400 dark:text-slate-500 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <dt className="text-xs text-slate-500 dark:text-slate-400">Date of Birth & Age</dt>
                <dd className="text-slate-900 dark:text-slate-100 mt-0.5">
                  {member.dateOfBirth ? (
                    <span>
                      {formatDateReadable(member.dateOfBirth)}
                      {age !== null && (
                        <span className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                          {' '}
                          ({age} yrs, auto-calculated)
                        </span>
                      )}
                    </span>
                  ) : age !== null ? (
                    <span className="font-mono tabular-nums">
                      {age} yrs{' '}
                      <span className="font-sans text-slate-500 dark:text-slate-400">
                        ({source === 'manual' ? 'manual entry' : 'calculated'})
                      </span>
                    </span>
                  ) : (
                    <span className="text-slate-400 dark:text-slate-500">Not recorded</span>
                  )}
                </dd>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <MapPin className="w-4 h-4 text-slate-400 dark:text-slate-500 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <dt className="text-xs text-slate-500 dark:text-slate-400">Address / Ancestral Place</dt>
                <dd className="text-slate-900 dark:text-slate-100 mt-0.5 break-words">
                  {member.address || <span className="text-slate-400 dark:text-slate-500">Not recorded</span>}
                </dd>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <FileText className="w-4 h-4 text-slate-400 dark:text-slate-500 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <dt className="text-xs text-slate-500 dark:text-slate-400">Notes</dt>
                <dd className="text-slate-700 dark:text-slate-300 mt-0.5 whitespace-pre-wrap break-words leading-relaxed">
                  {member.notes || <span className="text-slate-400 dark:text-slate-500">No notes yet</span>}
                </dd>
              </div>
            </div>
          </dl>
        </div>

        {/* Connected Family Trees (Cross-User Links) */}
        {(memberConnections.length > 0 || (isOwnerOfActiveTree && !isExternalTreeMember && onOpenConnectModal)) && (
          <div className="border-t border-slate-100 dark:border-slate-800 pt-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <GitMerge className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                Connected Family Trees
              </h4>
              {memberConnections.length > 0 && (
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {memberConnections.length} linked
                </span>
              )}
            </div>

            {memberConnections.length > 0 && (
              <ul className="space-y-2">
                {memberConnections.map((conn) => {
                  const rawMemberId = member.originalMemberId || member.id;
                  const isSourceSide =
                    conn.sourceTreeId === member.treeId && conn.sourceMemberId === rawMemberId;
                  const otherTreeId = isSourceSide ? conn.targetTreeId : conn.sourceTreeId;
                  const otherTreeName = isSourceSide ? conn.targetTreeName : conn.sourceTreeName;
                  const otherMemberName = isSourceSide
                    ? conn.targetMemberName
                    : conn.sourceMemberName;
                  const relationLabel = formatTreeLinkRelationship(
                    conn.relationshipType,
                    conn.relationshipDirection,
                    conn.customLabel,
                    isSourceSide ? 'source_to_target' : 'target_to_source'
                  );

                  return (
                    <li
                      key={conn.id}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 space-y-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {otherMemberName} · {otherTreeName}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          Linked as {relationLabel}
                        </p>
                      </div>
                      {onJumpToConnectedTree && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onJumpToConnectedTree(otherTreeId, false)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                          >
                            <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                            Open Tree
                          </button>
                          {!isCombinedView && (
                            <button
                              type="button"
                              onClick={() => onJumpToConnectedTree(member.treeId, true)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-md transition-colors"
                            >
                              <GitMerge className="w-3 h-3" aria-hidden="true" />
                              Combined View
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {isOwnerOfActiveTree && !isExternalTreeMember && onOpenConnectModal && (
              <button
                type="button"
                onClick={() => onOpenConnectModal(member.originalMemberId || member.id)}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                <GitMerge className="w-3.5 h-3.5" aria-hidden="true" />
                Connect with Another User’s Tree
              </button>
            )}
          </div>
        )}

        {/* Relationships */}
        <div className="border-t border-slate-100 dark:border-slate-800 pt-5 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
              Family Connections
            </h4>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {totalConnections} total
            </span>
          </div>

          {totalConnections === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 rounded-xl p-4">
              {effectiveCanEdit ? (
                <>
                  No relatives connected yet. Click <strong className="text-slate-800 dark:text-slate-200">Add Relative</strong> above to link
                  parents, spouses, children, siblings, or cousins.
                </>
              ) : (
                'No relatives connected to this member yet.'
              )}
            </p>
          ) : (
            <div className="space-y-4">
              <RelationGroup
                title="Parents"
                items={derived.parents}
                canEdit={effectiveCanEdit}
                onSelect={onSelectMember}
                onUnlink={onDeleteRelationship}
              />
              <RelationGroup
                title="Spouses"
                items={derived.spouses}
                canEdit={effectiveCanEdit}
                onSelect={onSelectMember}
                onUnlink={onDeleteRelationship}
              />
              <RelationGroup
                title="Children"
                items={derived.children}
                canEdit={effectiveCanEdit}
                onSelect={onSelectMember}
                onUnlink={onDeleteRelationship}
              />
              <RelationGroup
                title="Siblings"
                items={derived.siblings}
                canEdit={effectiveCanEdit}
                onSelect={onSelectMember}
                onUnlink={onDeleteRelationship}
              />
              <RelationGroup
                title="Cousins"
                items={derived.cousins}
                canEdit={effectiveCanEdit}
                onSelect={onSelectMember}
                onUnlink={onDeleteRelationship}
              />
              <RelationGroup
                title="Grandparents"
                items={derived.grandparents}
                canEdit={effectiveCanEdit}
                onSelect={onSelectMember}
                onUnlink={onDeleteRelationship}
              />
              <RelationGroup
                title="Grandchildren"
                items={derived.grandchildren}
                canEdit={effectiveCanEdit}
                onSelect={onSelectMember}
                onUnlink={onDeleteRelationship}
              />
              <RelationGroup
                title="Other Connections"
                items={derived.others}
                canEdit={effectiveCanEdit}
                onSelect={onSelectMember}
                onUnlink={onDeleteRelationship}
              />
            </div>
          )}
        </div>
      </div>

      {/* Footer Danger Zone */}
      <div className="px-5 py-3.5 pb-safe border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 shrink-0 flex items-center justify-between">
        <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
          Updated {new Date(member.updatedAt).toLocaleDateString()}
        </span>
        {effectiveCanEdit && (
          <button
            type="button"
            onClick={() => onDelete(member)}
            className="inline-flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-xs font-medium text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            Delete Member
          </button>
        )}
      </div>
    </aside>
    </>
  );
}
