import React, { useState } from 'react';
import {
  ChevronUp,
  Eye,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
} from 'lucide-react';
import type { LayoutNode } from '../types/family';
import { getEffectiveAge, getInitials } from '../lib/familyUtils';
import { GenderIndicator } from './GenderBadge';

interface MemberCardProps {
  node: LayoutNode;
  canEdit?: boolean;
  isSelected: boolean;
  isHighlighted: boolean;
  isDimmed: boolean;
  onSelect: (memberId: string) => void;
  onViewDetails: (memberId: string) => void;
  onEdit: (memberId: string) => void;
  onAddRelative: (memberId: string) => void;
  onDelete: (memberId: string) => void;
  onToggleCollapse: (memberId: string) => void;
}

export const MemberCard = React.memo(function MemberCard({
  node,
  canEdit = true,
  isSelected,
  isHighlighted,
  isDimmed,
  onSelect,
  onViewDetails,
  onEdit,
  onAddRelative,
  onDelete,
  onToggleCollapse,
}: MemberCardProps) {
  const { member, x, y, width, height, hasChildren, isCollapsed, hiddenDescendantCount } = node;
  const [imgError, setImgError] = useState(false);

  const isMale = member.gender === 'male';
  const { age } = getEffectiveAge(member);
  const initials = getInitials(member.fullName);

  const handleCardClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(member.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      onViewDetails(member.id);
    }
  };

  return (
    <div
      style={{
        transform: `translate3d(${x}px, ${y}px, 0)`,
        width: `${width}px`,
        height: `${height}px`,
      }}
      className={`group absolute top-0 left-0 select-none transition-opacity duration-150 ${
        isDimmed ? 'opacity-40' : 'opacity-100'
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={`${member.fullName}, ${isMale ? 'Male' : 'Female'}${age !== null ? `, age ${age}` : ''}`}
        aria-pressed={isSelected}
        onClick={handleCardClick}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onViewDetails(member.id);
        }}
        onKeyDown={handleKeyDown}
        className={`relative w-full h-full bg-white dark:bg-slate-900 rounded-xl overflow-hidden transition-shadow duration-150 flex flex-col justify-between ${
          isHighlighted
            ? 'ring-2 ring-blue-600 dark:ring-blue-400 border border-blue-600 dark:border-blue-400 shadow-lg'
            : isSelected
              ? 'ring-2 ring-slate-900 dark:ring-slate-100 border border-slate-900 dark:border-slate-100 shadow-md'
              : 'border border-slate-200/90 dark:border-slate-700/90 hover:border-slate-300 dark:hover:border-slate-500 shadow-xs hover:shadow-sm'
        }`}
      >
        {/* Clean 3px top gender stripe (Blue = Male, Pink = Female) */}
        <div
          className={`h-[3px] w-full shrink-0 ${isMale ? 'bg-blue-600 dark:bg-blue-500' : 'bg-pink-600 dark:bg-pink-500'}`}
          aria-hidden="true"
        />

        {/* Profile content */}
        <div className="flex items-center gap-3 px-3.5 py-2.5 flex-1 min-h-0">
          {/* Avatar or initials fallback */}
          <div
            className={`w-11 h-11 rounded-full shrink-0 overflow-hidden flex items-center justify-center font-semibold text-sm ring-1 ${
              isMale
                ? 'bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-800'
                : 'bg-pink-50 dark:bg-pink-950/70 text-pink-700 dark:text-pink-300 ring-pink-200 dark:ring-pink-800'
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
              <span>{initials}</span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p
              title={member.fullName}
              className="text-[13.5px] font-semibold text-slate-900 dark:text-slate-100 leading-snug truncate"
            >
              {member.fullName}
            </p>

            {/* Unboxed clean metadata with typographic separators */}
            <div className="flex items-center gap-1.5 mt-1 text-[11.5px] text-slate-500 dark:text-slate-400">
              <GenderIndicator gender={member.gender} compact />
              {age !== null && (
                <>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                    ·
                  </span>
                  <span className="font-mono tabular-nums text-slate-700 dark:text-slate-200 font-medium">
                    {age} yrs
                  </span>
                </>
              )}
            </div>

            {member.address && (
              <p
                title={member.address}
                className="flex items-center gap-1 mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate"
              >
                <MapPin className="w-3 h-3 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                <span className="truncate">{member.address}</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions Bar — shown on hover (desktop) or when selected (desktop, tablet & mobile) */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className={`absolute -top-11 sm:-top-9 left-1/2 -translate-x-1/2 z-20 flex items-center gap-0.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg px-1.5 py-1 shadow-md transition-opacity duration-150 ${
          isSelected
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'
        }`}
      >
        <button
          type="button"
          title="View Details"
          aria-label={`View details for ${member.fullName}`}
          onClick={() => onViewDetails(member.id)}
          className="p-2 sm:p-1.5 rounded-md hover:bg-slate-700 dark:hover:bg-slate-200 active:bg-slate-700 transition-colors"
        >
          <Eye className="w-4 h-4 sm:w-3.5 sm:h-3.5" aria-hidden="true" />
        </button>
        {canEdit && (
          <>
            <button
              type="button"
              title="Edit Member"
              aria-label={`Edit ${member.fullName}`}
              onClick={() => onEdit(member.id)}
              className="p-2 sm:p-1.5 rounded-md hover:bg-slate-700 dark:hover:bg-slate-200 active:bg-slate-700 transition-colors"
            >
              <Pencil className="w-4 h-4 sm:w-3.5 sm:h-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              title="Add Relative"
              aria-label={`Add relative to ${member.fullName}`}
              onClick={() => onAddRelative(member.id)}
              className="p-2 sm:p-1.5 rounded-md hover:bg-slate-700 dark:hover:bg-slate-200 active:bg-slate-700 transition-colors"
            >
              <UserPlus className="w-4 h-4 sm:w-3.5 sm:h-3.5" aria-hidden="true" />
            </button>
            <div className="w-px h-4 bg-slate-700 dark:bg-slate-300 mx-0.5" aria-hidden="true" />
            <button
              type="button"
              title="Delete Member"
              aria-label={`Delete ${member.fullName}`}
              onClick={() => onDelete(member.id)}
              className="p-2 sm:p-1.5 rounded-md text-rose-300 dark:text-rose-600 hover:bg-rose-600 hover:text-white dark:hover:bg-rose-600 dark:hover:text-white active:bg-rose-600 transition-colors"
            >
              <Trash2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      {/* Expand / Collapse Branch Control */}
      {hasChildren && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse(member.id);
          }}
          title={
            isCollapsed
              ? `Expand branch (${hiddenDescendantCount} hidden)`
              : 'Collapse branch'
          }
          aria-label={
            isCollapsed
              ? `Expand branch for ${member.fullName}, ${hiddenDescendantCount} hidden descendants`
              : `Collapse branch for ${member.fullName}`
          }
          className={`absolute -bottom-4 sm:-bottom-3.5 left-1/2 -translate-x-1/2 z-10 h-7 sm:h-6 min-w-[28px] px-2.5 sm:px-2 rounded-full border text-[11px] font-mono tabular-nums font-medium flex items-center justify-center gap-0.5 transition-colors shadow-xs ${
            isCollapsed
              ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100 hover:bg-slate-800 dark:hover:bg-white'
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          {isCollapsed ? (
            <>
              <Plus className="w-3 h-3" aria-hidden="true" />
              <span>{hiddenDescendantCount}</span>
            </>
          ) : (
            <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
          )}
        </button>
      )}
    </div>
  );
});
