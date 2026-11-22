import { useMemo, useState } from 'react';
import {
  Eye,
  GitFork,
  Pencil,
  Search,
  Trash2,
  UserPlus,
} from 'lucide-react';
import type { FamilyMember, FamilyRelationship, Gender } from '../types/family';
import { getEffectiveAge, getInitials } from '../lib/familyUtils';
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
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-slate-900 tracking-tight">
              Family Directory
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {canEdit
                ? `Browse, filter, and edit all ${members.length} recorded profiles across generations.`
                : `Browse and search all ${members.length} recorded profiles across generations (view-only access).`}
            </p>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={onAddMember}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap self-start sm:self-auto"
            >
              <UserPlus className="w-4 h-4" aria-hidden="true" />
              Add Family Member
            </button>
          )}
        </div>

        {/* Filter Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, village, or notes..."
              className="w-full pl-9 pr-3.5 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:border-slate-900"
            />
          </div>

          <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg self-start">
            {(['all', 'male', 'female'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setGenderFilter(opt)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  genderFilter === opt
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt === 'all' ? 'All Members' : opt === 'male' ? 'Male' : 'Female'}
              </button>
            ))}
          </div>
        </div>

        {/* High-Density Data Table */}
        {filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-3">
            <p className="text-sm font-medium text-slate-900">No family members match your filter</p>
            <p className="text-xs text-slate-500">
              Try adjusting your search query or add a new member to this family tree.
            </p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 pl-5 pr-4">Member</th>
                    <th className="py-3 px-4">Gender</th>
                    <th className="py-3 px-4 text-right">Gen</th>
                    <th className="py-3 px-4 text-right">Age</th>
                    <th className="py-3 px-4">Address / Place</th>
                    <th className="py-3 px-4 text-right">Links</th>
                    <th className="py-3 pl-4 pr-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filtered.map((m) => {
                    const isMale = m.gender === 'male';
                    const { age } = getEffectiveAge(m);
                    const gen = memberGenerationMap.get(m.id);
                    const linkCount = connectionCountMap.get(m.id) || 0;
                    return (
                      <tr key={m.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 pl-5 pr-4">
                          <div className="flex items-center gap-3 min-w-[180px]">
                            <div
                              className={`w-8 h-8 rounded-full shrink-0 overflow-hidden flex items-center justify-center text-xs font-semibold ring-1 ${
                                isMale
                                  ? 'bg-blue-50 text-blue-700 ring-blue-200'
                                  : 'bg-pink-50 text-pink-700 ring-pink-200'
                              }`}
                            >
                              {m.photoUrl ? (
                                <img
                                  src={m.photoUrl}
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
                                className="font-medium text-slate-900 hover:text-blue-700 truncate block text-left"
                              >
                                {m.fullName}
                              </button>
                              {m.notes && (
                                <p className="text-xs text-slate-400 truncate max-w-[240px]">
                                  {m.notes}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <GenderIndicator gender={m.gender} compact />
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-600">
                          {gen !== undefined ? `G${gen + 1}` : '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-700">
                          {age !== null ? `${age}` : '—'}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600 max-w-[200px] truncate">
                          {m.address || <span className="text-slate-300">—</span>}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-600">
                          {linkCount}
                        </td>
                        <td className="py-3 pl-4 pr-5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              title="Locate on Family Tree"
                              aria-label={`Locate ${m.fullName} on family tree`}
                              onClick={() => onLocateOnTree(m.id)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                            >
                              <GitFork className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              title="View Details"
                              aria-label={`View details for ${m.fullName}`}
                              onClick={() => onViewDetails(m.id)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            {canEdit && (
                              <>
                                <button
                                  type="button"
                                  title="Edit Member"
                                  aria-label={`Edit ${m.fullName}`}
                                  onClick={() => onEdit(m)}
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                                >
                                  <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  title="Delete Member"
                                  aria-label={`Delete ${m.fullName}`}
                                  onClick={() => onDelete(m)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
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
        )}
      </div>
    </div>
  );
}
