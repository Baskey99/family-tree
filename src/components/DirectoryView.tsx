import { useMemo, useState } from 'react';
import {
  Eye,
  GitFork,
  MapPin,
  Pencil,
  Search,
  Trash2,
  UserPlus,
} from 'lucide-react';
import type { FamilyMember, FamilyRelationship, Gender } from '../types/family';
import { getEffectiveAge, getInitials } from '../lib/familyUtils';
import { sanitizeImageUrl } from '../lib/security';
import { GenderIndicator } from './GenderBadge';

interface DirectoryViewProps {
  members: FamilyMember[];
  relationships: FamilyRelationship[];
  memberGenerationMap: Map<string, number>;
  canEdit?: boolean;
  onLocateOnTree: (memberId: string) => void;
  onViewDetails: (memberId: string) => void;
  onEdit: (member: FamilyMember) => void;
  onDelete: (member: FamilyMember) => void;
  onAddMember: () => void;
}

export function DirectoryView({
  members,
  relationships,
  memberGenerationMap,
  canEdit = true,
  onLocateOnTree,
  onViewDetails,
  onEdit,
  onDelete,
  onAddMember,
}: DirectoryViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [genderFilter, setGenderFilter] = useState<'all' | Gender>('all');

  const connectionCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const rel of relationships) {
      map.set(rel.personId, (map.get(rel.personId) || 0) + 1);
      map.set(rel.relatedPersonId, (map.get(rel.relatedPersonId) || 0) + 1);
    }
    return map;
  }, [relationships]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return members
      .filter((m) => {
        if (genderFilter !== 'all' && m.gender !== genderFilter) return false;
        if (!q) return true;
        return (
          m.fullName.toLowerCase().includes(q) ||
          m.address.toLowerCase().includes(q) ||
          m.notes.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const ga = memberGenerationMap.get(a.id) ?? 99;
        const gb = memberGenerationMap.get(b.id) ?? 99;
        if (ga !== gb) return ga - gb;
        return a.fullName.localeCompare(b.fullName);
      });
  }, [members, searchQuery, genderFilter, memberGenerationMap]);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-5 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="font-display text-xl sm:text-2xl font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
              Family Directory
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
              {canEdit
                ? `Browse, filter, and edit all ${members.length} recorded profiles across generations.`
                : `Browse and search all ${members.length} recorded profiles across generations (view-only access).`}
            </p>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={onAddMember}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 sm:py-2 text-xs font-medium text-white dark:text-slate-900 bg-slate-900 dark:bg-slate-100 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors whitespace-nowrap w-full sm:w-auto"
            >
              <UserPlus className="w-4 h-4" aria-hidden="true" />
              Add Family Member
            </button>
          )}
        </div>

        {/* Filter Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 sm:max-w-md">
            <Search
              className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, city, or notes..."
              className="w-full pl-9 pr-3.5 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-slate-900 dark:focus:border-slate-400"
            />
          </div>

          <div className="grid grid-cols-3 sm:inline-flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg w-full sm:w-auto">
            {(['all', 'male', 'female'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setGenderFilter(opt)}
                className={`px-3 py-2 sm:py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap text-center ${
                  genderFilter === opt
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {opt === 'all' ? 'All Members' : opt === 'male' ? 'Male' : 'Female'}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 sm:p-10 text-center space-y-2.5">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              No family members match your filter
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Try adjusting your search query or add a new member to this family tree.
            </p>
          </div>
        ) : (
          <>
            {/* Mobile Stacked Profile Cards (< md) */}
            <div className="md:hidden space-y-3">
              {filtered.map((m) => {
                const isMale = m.gender === 'male';
                const { age } = getEffectiveAge(m);
                const gen = memberGenerationMap.get(m.id);
                const linkCount = connectionCountMap.get(m.id) || 0;
                return (
                  <div
                    key={m.id}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden"
                  >
                    <div
                      className={`h-[3px] w-full ${isMale ? 'bg-blue-600 dark:bg-blue-500' : 'bg-pink-600 dark:bg-pink-500'}`}
                      aria-hidden="true"
                    />
                    <div className="p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-10 h-10 rounded-full shrink-0 overflow-hidden flex items-center justify-center text-xs font-semibold ring-1 ${
                            isMale
                              ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-800/70'
                              : 'bg-pink-50 dark:bg-pink-950/60 text-pink-700 dark:text-pink-300 ring-pink-200 dark:ring-pink-800/70'
                          }`}
                        >
                          {sanitizeImageUrl(m.photoUrl) ? (
                            <img
                              src={sanitizeImageUrl(m.photoUrl)}
                              alt={m.fullName}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span>{getInitials(m.fullName)}</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => onViewDetails(m.id)}
                            className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:text-blue-700 dark:hover:text-blue-400 text-left break-words"
                          >
                            {m.fullName}
                          </button>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400 mt-1">
                            <GenderIndicator gender={m.gender} compact />
                            {gen !== undefined && (
                              <>
                                <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                                  ·
                                </span>
                                <span className="font-mono tabular-nums">Gen {gen + 1}</span>
                              </>
                            )}
                            {age !== null && (
                              <>
                                <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                                  ·
                                </span>
                                <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                  {age} yrs
                                </span>
                              </>
                            )}
                            <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                              ·
                            </span>
                            <span className="font-mono tabular-nums">{linkCount} links</span>
                          </div>
                          {m.address && (
                            <p className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 mt-1.5 truncate">
                              <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                              <span className="truncate">{m.address}</span>
                            </p>
                          )}
                          {m.notes && (
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 line-clamp-2">{m.notes}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-slate-100 dark:border-slate-800">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onLocateOnTree(m.id)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                          >
                            <GitFork className="w-3.5 h-3.5" aria-hidden="true" />
                            Tree
                          </button>
                          <button
                            type="button"
                            onClick={() => onViewDetails(m.id)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                            Details
                          </button>
                        </div>

                        {canEdit && (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              aria-label={`Edit ${m.fullName}`}
                              onClick={() => onEdit(m)}
                              className="p-2 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <Pencil className="w-4 h-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${m.fullName}`}
                              onClick={() => onDelete(m)}
                              className="p-2 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                            >
                              <Trash2 className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Tablet & Desktop High-Density Table (md+) */}
            <div className="hidden md:block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      <th className="py-3 pl-5 pr-4">Member</th>
                      <th className="py-3 px-4">Gender</th>
                      <th className="py-3 px-4 text-right">Gen</th>
                      <th className="py-3 px-4 text-right">Age</th>
                      <th className="hidden lg:table-cell py-3 px-4">Address / Place</th>
                      <th className="hidden lg:table-cell py-3 px-4 text-right">Links</th>
                      <th className="py-3 pl-4 pr-5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                    {filtered.map((m) => {
                      const isMale = m.gender === 'male';
                      const { age } = getEffectiveAge(m);
                      const gen = memberGenerationMap.get(m.id);
                      const linkCount = connectionCountMap.get(m.id) || 0;
                      return (
                        <tr key={m.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition-colors">
                          <td className="py-3 pl-5 pr-4">
                            <div className="flex items-center gap-3 min-w-[180px]">
                              <div
                                className={`w-8 h-8 rounded-full shrink-0 overflow-hidden flex items-center justify-center text-xs font-semibold ring-1 ${
                                  isMale
                                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-800/70'
                                    : 'bg-pink-50 dark:bg-pink-950/60 text-pink-700 dark:text-pink-300 ring-pink-200 dark:ring-pink-800/70'
                                }`}
                              >
                                {sanitizeImageUrl(m.photoUrl) ? (
                                  <img
                                    src={sanitizeImageUrl(m.photoUrl)}
                                    alt={m.fullName}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <span>{getInitials(m.fullName)}</span>
                                )}
                              </div>
                              <div className="min-w-0">
                                <button
                                  type="button"
                                  onClick={() => onViewDetails(m.id)}
                                  className="font-medium text-slate-900 dark:text-slate-100 hover:text-blue-700 dark:hover:text-blue-400 truncate block text-left"
                                >
                                  {m.fullName}
                                </button>
                                {(m.address || m.notes) && (
                                  <p className="text-xs text-slate-400 dark:text-slate-500 truncate max-w-[240px]">
                                    <span className="lg:hidden">{m.address || m.notes}</span>
                                    <span className="hidden lg:inline">{m.notes}</span>
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <GenderIndicator gender={m.gender} compact />
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-600 dark:text-slate-400">
                            {gen !== undefined ? `G${gen + 1}` : '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                            {age !== null ? `${age}` : '—'}
                          </td>
                          <td className="hidden lg:table-cell py-3 px-4 text-xs text-slate-600 dark:text-slate-400 max-w-[200px] truncate">
                            {m.address || <span className="text-slate-300 dark:text-slate-600">—</span>}
                          </td>
                          <td className="hidden lg:table-cell py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-600 dark:text-slate-400">
                            {linkCount}
                          </td>
                          <td className="py-3 pl-4 pr-5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                title="Locate on Family Tree"
                                aria-label={`Locate ${m.fullName} on family tree`}
                                onClick={() => onLocateOnTree(m.id)}
                                className="p-2 lg:p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                              >
                                <GitFork className="w-4 h-4 lg:w-3.5 lg:h-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                title="View Details"
                                aria-label={`View details for ${m.fullName}`}
                                onClick={() => onViewDetails(m.id)}
                                className="p-2 lg:p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                              >
                                <Eye className="w-4 h-4 lg:w-3.5 lg:h-3.5" aria-hidden="true" />
                              </button>
                              {canEdit && (
                                <>
                                  <button
                                    type="button"
                                    title="Edit Member"
                                    aria-label={`Edit ${m.fullName}`}
                                    onClick={() => onEdit(m)}
                                    className="p-2 lg:p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                  >
                                    <Pencil className="w-4 h-4 lg:w-3.5 lg:h-3.5" aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    title="Delete Member"
                                    aria-label={`Delete ${m.fullName}`}
                                    onClick={() => onDelete(m)}
                                    className="p-2 lg:p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                                  >
                                    <Trash2 className="w-4 h-4 lg:w-3.5 lg:h-3.5" aria-hidden="true" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
