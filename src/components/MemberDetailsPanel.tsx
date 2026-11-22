import { useMemo, useState } from 'react';
import {
  Calendar,
  FileText,
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
} from '../types/family';
import {
  deriveMemberRelationships,
  formatDateReadable,
  getEffectiveAge,
  getInitials,
} from '../lib/familyUtils';
import { GenderIndicator } from './GenderBadge';

interface MemberDetailsPanelProps {
  member: FamilyMember | null;
  members: FamilyMember[];
  relationships: FamilyRelationship[];
  generation: number | undefined;
  canEdit?: boolean;
  onClose: () => void;
  onSelectMember: (memberId: string) => void;
  onEdit: (member: FamilyMember) => void;
  onAddRelative: (member: FamilyMember) => void;
  onDelete: (member: FamilyMember) => void;
  onDeleteRelationship: (relationshipId: string) => void;
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
      <h4 className="text-xs font-semibold text-slate-500 tracking-wide">
        {title} ({items.length})
      </h4>
      <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white overflow-hidden">
        {items.map((item) => {
          const isMale = item.member.gender === 'male';
          return (
            <li
              key={`${title}_${item.member.id}_${item.relationshipId || 'derived'}`}
              className="flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-slate-50 transition-colors"
            >
              <button
                type="button"
                onClick={() => onSelect(item.member.id)}
                className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
              >
                <span
                  className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold ${
                    isMale
                      ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                      : 'bg-pink-50 text-pink-700 ring-1 ring-pink-200'
                  }`}
                >
                  {getInitials(item.member.fullName)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900 truncate">
                    {item.member.fullName}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {item.label}
                    {item.isDerived ? ' · Derived' : ''}
                  </span>
                </span>
              </button>

              {canEdit && item.relationshipId && !item.isDerived && (
                <button
                  type="button"
                  title="Remove connection"
                  aria-label={`Remove connection to ${item.member.fullName}`}
                  onClick={() => onUnlink(item.relationshipId!)}
                  className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0"
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
  canEdit = true,
  onClose,
  onSelectMember,
  onEdit,
  onAddRelative,
  onDelete,
  onDeleteRelationship,
}: MemberDetailsPanelProps) {
  const [imgError, setImgError] = useState(false);

  const derived = useMemo(() => {
    if (!member) return null;
    return deriveMemberRelationships(member.id, members, relationships);
  }, [member, members, relationships]);

  if (!member || !derived) return null;

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
        className="fixed inset-0 z-40 bg-slate-900/35 backdrop-blur-[1px] lg:hidden"
      />

      <aside
        aria-label="Member details"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] rounded-t-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:rounded-none sm:w-[380px] bg-white border-t sm:border-t-0 sm:border-l border-slate-200 shadow-2xl flex flex-col lg:static lg:shadow-none lg:z-10 lg:w-[380px] lg:shrink-0"
      >
        {/* Mobile sheet drag handle indicator */}
        <div className="flex justify-center pt-2.5 pb-1 sm:hidden shrink-0" aria-hidden="true">
          <div className="w-10 h-1 rounded-full bg-slate-300" />
        </div>

        {/* Top Bar */}
        <div className="flex items-center justify-between px-5 py-3.5 sm:py-4 border-b border-slate-200 shrink-0">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500">Member Profile</p>
            <h2 className="font-display text-base font-semibold text-slate-900 truncate">
              {member.fullName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close member details"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
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
                ? 'bg-blue-50 text-blue-700 ring-blue-200'
                : 'bg-pink-50 text-pink-700 ring-pink-200'
            }`}
          >
            {member.photoUrl && !imgError ? (
              <img
                src={member.photoUrl}
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
            <h3 className="font-display text-lg font-semibold text-slate-900 leading-tight break-words">
              {member.fullName}
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <GenderIndicator gender={member.gender} />
              {generation !== undefined && (
                <>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span className="font-mono tabular-nums text-slate-700">
                    Generation {generation + 1}
                  </span>
                </>
              )}
              {age !== null && (
                <>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <span className="font-mono tabular-nums text-slate-800 font-medium">
                    {age} yrs
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        {canEdit ? (
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => onAddRelative(member)}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
              Add Relative
            </button>
            <button
              type="button"
              onClick={() => onEdit(member)}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-medium bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              Edit Profile
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200/80 rounded-lg px-3.5 py-2.5">
            View-only access · Ask the family tree owner for Editor access to make changes.
          </p>
        )}

        {/* Personal Details */}
        <div className="border-t border-slate-100 pt-5 space-y-3">
          <h4 className="text-xs font-semibold text-slate-500 tracking-wide">Details</h4>

          <dl className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <Calendar className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <dt className="text-xs text-slate-500">Date of Birth & Age</dt>
                <dd className="text-slate-900 mt-0.5">
                  {member.dateOfBirth ? (
                    <span>
                      {formatDateReadable(member.dateOfBirth)}
                      {age !== null && (
                        <span className="text-slate-500 font-mono tabular-nums">
                          {' '}
                          ({age} yrs, auto-calculated)
                        </span>
                      )}
                    </span>
                  ) : age !== null ? (
                    <span className="font-mono tabular-nums">
                      {age} yrs{' '}
                      <span className="font-sans text-slate-500">
                        ({source === 'manual' ? 'manual entry' : 'calculated'})
                      </span>
                    </span>
                  ) : (
                    <span className="text-slate-400">Not recorded</span>
                  )}
                </dd>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <MapPin className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <dt className="text-xs text-slate-500">Address / Ancestral Place</dt>
                <dd className="text-slate-900 mt-0.5 break-words">
                  {member.address || <span className="text-slate-400">Not recorded</span>}
                </dd>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <FileText className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <dt className="text-xs text-slate-500">Notes</dt>
                <dd className="text-slate-700 mt-0.5 whitespace-pre-wrap break-words leading-relaxed">
                  {member.notes || <span className="text-slate-400">No notes yet</span>}
                </dd>
              </div>
            </div>
          </dl>
        </div>

        {/* Relationships */}
        <div className="border-t border-slate-100 pt-5 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              Family Connections
            </h4>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {totalConnections} total
            </span>
          </div>

          {totalConnections === 0 ? (
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200/80 rounded-xl p-4">
              {canEdit ? (
                <>
                  No relatives connected yet. Click <strong>Add Relative</strong> above to link
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
                canEdit={canEdit}
                onSelect={onSelectMember}
                onUnlink={onDeleteRelationship}
              />
              <RelationGroup
                title="Spouses"
                items={derived.spouses}
                canEdit={canEdit}
                onSelect={onSelectMember}
                onUnlink={onDeleteRelationship}
              />
              <RelationGroup
                title="Children"
                items={derived.children}
                canEdit={canEdit}
                onSelect={onSelectMember}
                onUnlink={onDeleteRelationship}
              />
              <RelationGroup
                title="Siblings"
                items={derived.siblings}
                canEdit={canEdit}
                onSelect={onSelectMember}
                onUnlink={onDeleteRelationship}
              />
              <RelationGroup
                title="Cousins"
                items={derived.cousins}
                canEdit={canEdit}
                onSelect={onSelectMember}
                onUnlink={onDeleteRelationship}
              />
              <RelationGroup
                title="Grandparents"
                items={derived.grandparents}
                canEdit={canEdit}
                onSelect={onSelectMember}
                onUnlink={onDeleteRelationship}
              />
              <RelationGroup
                title="Grandchildren"
                items={derived.grandchildren}
                canEdit={canEdit}
                onSelect={onSelectMember}
                onUnlink={onDeleteRelationship}
              />
              <RelationGroup
                title="Other Connections"
                items={derived.others}
                canEdit={canEdit}
                onSelect={onSelectMember}
                onUnlink={onDeleteRelationship}
              />
            </div>
          )}
        </div>
      </div>

      {/* Footer Danger Zone */}
      <div className="px-5 py-3.5 pb-safe border-t border-slate-200 bg-slate-50/70 shrink-0 flex items-center justify-between">
        <span className="text-[11px] text-slate-500 font-mono tabular-nums">
          Updated {new Date(member.updatedAt).toLocaleDateString()}
        </span>
        {canEdit && (
          <button
            type="button"
            onClick={() => onDelete(member)}
            className="inline-flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 rounded-lg transition-colors"
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
