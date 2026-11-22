import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Link2,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  FamilyMember,
  FamilyRelationship,
  FormRelationshipType,
  Gender,
  StoredRelationshipType,
} from '../types/family';
import {
  calculateAgeFromDob,
  compressImageToDataUrl,
  getInitials,
  inferDefaultGenderForRelation,
} from '../lib/familyUtils';
import type { MemberInputPayload } from '../hooks/useFamilyStore';
import { GenderIndicator } from './GenderBadge';

const RELATIONSHIP_OPTIONS: { value: FormRelationshipType; label: string; hint: string }[] = [
  { value: 'father', label: 'Father', hint: 'Parent (generation above)' },
  { value: 'mother', label: 'Mother', hint: 'Parent (generation above)' },
  { value: 'husband', label: 'Husband', hint: 'Spouse (same generation)' },
  { value: 'wife', label: 'Wife', hint: 'Spouse (same generation)' },
  { value: 'son', label: 'Son', hint: 'Child (generation below)' },
  { value: 'daughter', label: 'Daughter', hint: 'Child (generation below)' },
  { value: 'brother', label: 'Brother', hint: 'Sibling (same generation)' },
  { value: 'sister', label: 'Sister', hint: 'Sibling (same generation)' },
  { value: 'cousin', label: 'Cousin', hint: 'Same generation, separate branch' },
  { value: 'grandfather', label: 'Grandfather', hint: 'Two generations above' },
  { value: 'grandmother', label: 'Grandmother', hint: 'Two generations above' },
  { value: 'other', label: 'Other', hint: 'Specify custom relationship' },
];

interface MemberFormModalProps {
  open: boolean;
  mode: 'add' | 'edit';
  editingMember: FamilyMember | null;
  defaultRelatedMemberId: string | null;
  members: FamilyMember[];
  relationships: FamilyRelationship[];
  onClose: () => void;
  onSubmitAdd: (payload: MemberInputPayload) => Promise<string>;
  onSubmitEdit: (
    memberId: string,
    payload: Omit<MemberInputPayload, 'relationship'>
  ) => Promise<void>;
  onLinkExisting: (
    personId: string,
    relatedPersonId: string,
    relationshipType: StoredRelationshipType,
    customLabel: string
  ) => Promise<void>;
}

export function MemberFormModal({
  open,
  mode,
  editingMember,
  defaultRelatedMemberId,
  members,
  relationships,
  onClose,
  onSubmitAdd,
  onSubmitEdit,
  onLinkExisting,
}: MemberFormModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const [tab, setTab] = useState<'new' | 'link'>('new');
  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState<Gender>('male');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [manualAgeText, setManualAgeText] = useState('');
  const [address, setAddress] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [notes, setNotes] = useState('');

  // Relationship fields (for Add mode)
  const [relatedMemberId, setRelatedMemberId] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [relationshipType, setRelationshipType] = useState<FormRelationshipType>('son');
  const [customLabel, setCustomLabel] = useState('');
  const [alsoLinkSpouseAsParent, setAlsoLinkSpouseAsParent] = useState(true);
  const [targetParentId, setTargetParentId] = useState('');

  // Link-existing fields (avoid duplicating existing people)
  const [existingTargetId, setExistingTargetId] = useState('');
  const [existingSearch, setExistingSearch] = useState('');

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Sync form fields when modal opens
  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setPhotoError(null);
    setSubmitting(false);
    setTab('new');
    setMemberSearch('');
    setExistingSearch('');
    setExistingTargetId('');

    if (mode === 'edit' && editingMember) {
      setFullName(editingMember.fullName);
      setGender(editingMember.gender);
      setDateOfBirth(editingMember.dateOfBirth || '');
      setManualAgeText(
        editingMember.manualAge !== null && editingMember.manualAge !== undefined
          ? String(editingMember.manualAge)
          : ''
      );
      setAddress(editingMember.address || '');
      setPhotoUrl(editingMember.photoUrl || '');
      setNotes(editingMember.notes || '');
      setRelatedMemberId('');
    } else {
      setFullName('');
      setGender('male');
      setDateOfBirth('');
      setManualAgeText('');
      setAddress('');
      setPhotoUrl('');
      setNotes('');
      setRelatedMemberId(defaultRelatedMemberId || '');
      setRelationshipType('son');
      setCustomLabel('');
      setAlsoLinkSpouseAsParent(true);
      setTargetParentId('');
    }

    window.setTimeout(() => nameInputRef.current?.focus(), 40);
  }, [open, mode, editingMember, defaultRelatedMemberId]);

  // Escape key closes modal
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const calculatedAge = useMemo(() => calculateAgeFromDob(dateOfBirth), [dateOfBirth]);

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [members]
  );

  const filteredRelatedMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return sortedMembers;
    return sortedMembers.filter(
      (m) =>
        m.fullName.toLowerCase().includes(q) ||
        m.address.toLowerCase().includes(q)
    );
  }, [sortedMembers, memberSearch]);

  const filteredExistingTargets = useMemo(() => {
    const q = existingSearch.trim().toLowerCase();
    return sortedMembers.filter((m) => {
      if (m.id === relatedMemberId) return false;
      if (!q) return true;
      return (
        m.fullName.toLowerCase().includes(q) ||
        m.address.toLowerCase().includes(q)
      );
    });
  }, [sortedMembers, existingSearch, relatedMemberId]);

  const selectedRelatedMember = useMemo(
    () => members.find((m) => m.id === relatedMemberId) || null,
    [members, relatedMemberId]
  );

  // Spouse of relatedMember (for optional co-parent link when adding Son/Daughter)
  const relatedMemberSpouse = useMemo(() => {
    if (!relatedMemberId) return null;
    const rel = relationships.find(
      (r) =>
        r.relationshipType === 'spouse' &&
        (r.personId === relatedMemberId || r.relatedPersonId === relatedMemberId)
    );
    if (!rel) return null;
    const spId = rel.personId === relatedMemberId ? rel.relatedPersonId : rel.personId;
    return members.find((m) => m.id === spId) || null;
  }, [relatedMemberId, relationships, members]);

  // Parents of relatedMember (for Grandfather / Grandmother placement)
  const relatedMemberParents = useMemo(() => {
    if (!relatedMemberId) return [];
    const pIds = relationships
      .filter((r) => r.relationshipType === 'parent_child' && r.relatedPersonId === relatedMemberId)
      .map((r) => r.personId);
    return members.filter((m) => pIds.includes(m.id));
  }, [relatedMemberId, relationships, members]);

  // Warn if exact name already exists in tree (prevent accidental duplicates)
  const matchingExistingMember = useMemo(() => {
    if (mode !== 'add') return null;
    const clean = fullName.trim().toLowerCase();
    if (clean.length < 2) return null;
    return members.find((m) => m.fullName.trim().toLowerCase() === clean) || null;
  }, [mode, fullName, members]);

  if (!open) return null;

  const handleRelationTypeChange = (nextType: FormRelationshipType) => {
    setRelationshipType(nextType);
    const inferred = inferDefaultGenderForRelation(nextType);
    if (inferred) setGender(inferred);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError(null);
    setUploadingPhoto(true);
    try {
      const compressed = await compressImageToDataUrl(file);
      setPhotoUrl(compressed);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Failed to upload profile photo.');
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (mode === 'add' && tab === 'link') {
      if (!relatedMemberId || !existingTargetId) {
        setFormError('Please select both family members to connect.');
        return;
      }
      if (relationshipType === 'other' && !customLabel.trim()) {
        setFormError('Please specify the custom relationship label.');
        return;
      }
      setSubmitting(true);
      try {
        // Translate FormRelationshipType into normalized stored edge between existingTargetId and relatedMemberId
        let personId = relatedMemberId;
        let relatedPersonId = existingTargetId;
        let storedType: StoredRelationshipType = 'other';
        let label = customLabel.trim();

        if (relationshipType === 'father' || relationshipType === 'mother') {
          personId = existingTargetId;
          relatedPersonId = relatedMemberId;
          storedType = 'parent_child';
        } else if (relationshipType === 'son' || relationshipType === 'daughter') {
          personId = relatedMemberId;
          relatedPersonId = existingTargetId;
          storedType = 'parent_child';
        } else if (relationshipType === 'husband' || relationshipType === 'wife') {
          storedType = 'spouse';
        } else if (relationshipType === 'brother' || relationshipType === 'sister') {
          storedType = 'sibling';
        } else if (relationshipType === 'cousin') {
          storedType = 'cousin';
        } else if (relationshipType === 'grandfather' || relationshipType === 'grandmother') {
          personId = existingTargetId;
          relatedPersonId = relatedMemberId;
          storedType = 'other';
          label = relationshipType === 'grandfather' ? 'Grandfather' : 'Grandmother';
        }

        await onLinkExisting(personId, relatedPersonId, storedType, label);
        onClose();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Could not link members.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const cleanName = fullName.trim();
    if (!cleanName) {
      setFormError('Full Name is required.');
      return;
    }

    if (dateOfBirth && calculatedAge === null) {
      setFormError('Please enter a valid Date of Birth (cannot be in the future).');
      return;
    }

    let parsedManualAge: number | null = null;
    if (!dateOfBirth && manualAgeText.trim() !== '') {
      const num = Number(manualAgeText);
      if (Number.isNaN(num) || num < 0 || num > 130) {
        setFormError('Manual age must be a number between 0 and 130.');
        return;
      }
      parsedManualAge = Math.floor(num);
    }

    if (mode === 'add' && relatedMemberId && relationshipType === 'other' && !customLabel.trim()) {
      setFormError('Please specify the relationship when "Other" is selected.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'edit' && editingMember) {
        await onSubmitEdit(editingMember.id, {
          fullName: cleanName,
          gender,
          dateOfBirth,
          manualAge: parsedManualAge,
          address,
          photoUrl,
          notes,
        });
      } else {
        await onSubmitAdd({
          fullName: cleanName,
          gender,
          dateOfBirth,
          manualAge: parsedManualAge,
          address,
          photoUrl,
          notes,
          relationship: relatedMemberId
            ? {
                relatedMemberId,
                relationshipType,
                customLabel: customLabel.trim(),
                alsoLinkSpouseAsParent,
                targetParentIdForGrandparent: targetParentId || undefined,
              }
            : undefined,
        });
      }
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save family member.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="member-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[92vh] bg-white border border-slate-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2
              id="member-modal-title"
              className="font-display text-lg font-semibold text-slate-900"
            >
              {mode === 'edit' ? 'Edit Family Member' : 'Add Family Member'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {mode === 'edit'
                ? 'Updating personal details keeps all existing family connections intact.'
                : 'Create a profile and connect them into the family hierarchy.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Mode Tabs in Add Mode (Create New vs Link Existing Relative) */}
        {mode === 'add' && members.length > 0 && (
          <div className="px-6 pt-3 pb-0 border-b border-slate-100 shrink-0">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg mb-3">
              <button
                type="button"
                onClick={() => {
                  setTab('new');
                  setFormError(null);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  tab === 'new'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                Create New Member
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab('link');
                  setFormError(null);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  tab === 'link'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                Connect Existing Member
              </button>
            </div>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {formError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{formError}</span>
            </div>
          )}

          {mode === 'add' && tab === 'link' ? (
            <div className="space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Connect two existing family members without creating a duplicate profile.
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Existing Member (Subject)
                </label>
                <input
                  type="text"
                  value={existingSearch}
                  onChange={(e) => setExistingSearch(e.target.value)}
                  placeholder="Filter members by name..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg mb-2 focus:border-slate-900"
                />
                <select
                  value={existingTargetId}
                  onChange={(e) => setExistingTargetId(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:border-slate-900"
                >
                  <option value="">Select member...</option>
                  {filteredExistingTargets.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName}
                      {m.address ? ` (${m.address})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Is the ... of
                </label>
                <select
                  value={relationshipType}
                  onChange={(e) =>
                    setRelationshipType(e.target.value as FormRelationshipType)
                  }
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:border-slate-900"
                >
                  {RELATIONSHIP_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} — {opt.hint}
                    </option>
                  ))}
                </select>
              </div>

              {relationshipType === 'other' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Specify Relationship *
                  </label>
                  <input
                    type="text"
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                    maxLength={80}
                    placeholder="e.g., Maternal Uncle, Adopted Child, Guardian"
                    required
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-slate-900"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Related Family Member
                </label>
                <select
                  value={relatedMemberId}
                  onChange={(e) => setRelatedMemberId(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:border-slate-900"
                >
                  <option value="">Select related member...</option>
                  {sortedMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName}
                      {m.address ? ` (${m.address})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <>
              {/* Profile Photo Upload */}
              <div className="flex items-center gap-4">
                <div
                  className={`w-16 h-16 rounded-2xl shrink-0 overflow-hidden flex items-center justify-center text-base font-semibold ring-1 ${
                    gender === 'male'
                      ? 'bg-blue-50 text-blue-700 ring-blue-200'
                      : 'bg-pink-50 text-pink-700 ring-pink-200'
                  }`}
                >
                  {photoUrl ? (
                    <img
                      src={photoUrl}
                      alt="Profile preview"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span>{getInitials(fullName || 'FM')}</span>
                  )}
                </div>

                <div className="flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="hidden"
                      id="member-photo-upload"
                    />
                    <button
                      type="button"
                      disabled={uploadingPhoto}
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                      {uploadingPhoto
                        ? 'Processing...'
                        : photoUrl
                          ? 'Change Photo'
                          : 'Upload Photo'}
                    </button>
                    {photoUrl && (
                      <button
                        type="button"
                        onClick={() => setPhotoUrl('')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Remove
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Optional. Auto-cropped to a crisp avatar; initials fallback is shown if empty.
                  </p>
                  {photoError && <p className="text-xs text-rose-600">{photoError}</p>}
                </div>
              </div>

              {/* Full Name */}
              <div>
                <label
                  htmlFor="member-fullname"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Full Name <span className="text-rose-600">*</span>
                </label>
                <input
                  ref={nameInputRef}
                  id="member-fullname"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  maxLength={140}
                  required
                  placeholder="e.g., Amit Baskey"
                  className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:border-slate-900"
                />
                {matchingExistingMember && (
                  <div className="mt-2 flex items-center justify-between gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                    <span>
                      <strong>{matchingExistingMember.fullName}</strong> already exists in this
                      tree.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setTab('link');
                        setExistingTargetId(matchingExistingMember.id);
                      }}
                      className="font-semibold underline whitespace-nowrap shrink-0"
                    >
                      Connect instead
                    </button>
                  </div>
                )}
              </div>

              {/* Gender */}
              <fieldset>
                <legend className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Gender <span className="text-rose-600">*</span>
                </legend>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setGender('male')}
                    aria-pressed={gender === 'male'}
                    className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                      gender === 'male'
                        ? 'bg-blue-50 border-blue-600 text-blue-800 ring-1 ring-blue-600'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <GenderIndicator gender="male" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setGender('female')}
                    aria-pressed={gender === 'female'}
                    className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                      gender === 'female'
                        ? 'bg-pink-50 border-pink-600 text-pink-800 ring-1 ring-pink-600'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <GenderIndicator gender="female" />
                  </button>
                </div>
              </fieldset>

              {/* Date of Birth & Age */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="member-dob"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Date of Birth <span className="font-normal text-slate-400">(Optional)</span>
                  </label>
                  <input
                    id="member-dob"
                    type="date"
                    value={dateOfBirth}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:border-slate-900"
                  />
                </div>

                <div>
                  <label
                    htmlFor="member-age"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Age{' '}
                    <span className="font-normal text-slate-400">
                      {dateOfBirth ? '(Auto from DOB)' : '(Manual if no DOB)'}
                    </span>
                  </label>
                  {dateOfBirth ? (
                    <div
                      id="member-age"
                      className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-mono tabular-nums"
                    >
                      {calculatedAge !== null ? `${calculatedAge} years` : 'Invalid date'}
                    </div>
                  ) : (
                    <input
                      id="member-age"
                      type="number"
                      min={0}
                      max={130}
                      value={manualAgeText}
                      onChange={(e) => setManualAgeText(e.target.value)}
                      placeholder="e.g., 32"
                      className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg font-mono tabular-nums focus:border-slate-900"
                    />
                  )}
                </div>
              </div>

              {/* Address */}
              <div>
                <label
                  htmlFor="member-address"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Address / Village <span className="font-normal text-slate-400">(Optional)</span>
                </label>
                <input
                  id="member-address"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  maxLength={250}
                  placeholder="e.g., Baghiya, Tilkagarh"
                  className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:border-slate-900"
                />
              </div>

              {/* Relationship Section (only in Add mode when tree already has members) */}
              {mode === 'add' && members.length > 0 && (
                <div className="border-t border-slate-200 pt-5 space-y-4">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-900">
                      Relationship Placement
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Define how {fullName.trim() || 'this new member'} relates to an existing
                      member so the tree positions them automatically.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label
                        htmlFor="rel-type"
                        className="block text-xs font-semibold text-slate-700 mb-1.5"
                      >
                        Relationship Type
                      </label>
                      <select
                        id="rel-type"
                        value={relationshipType}
                        onChange={(e) =>
                          handleRelationTypeChange(e.target.value as FormRelationshipType)
                        }
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:border-slate-900"
                      >
                        {RELATIONSHIP_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {RELATIONSHIP_OPTIONS.find((o) => o.value === relationshipType)?.hint}
                      </p>
                    </div>

                    <div>
                      <label
                        htmlFor="rel-member"
                        className="block text-xs font-semibold text-slate-700 mb-1.5"
                      >
                        Related Family Member
                      </label>
                      {members.length > 12 && (
                        <input
                          type="text"
                          value={memberSearch}
                          onChange={(e) => setMemberSearch(e.target.value)}
                          placeholder="Filter list by name..."
                          className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg mb-1.5 focus:border-slate-900"
                        />
                      )}
                      <select
                        id="rel-member"
                        value={relatedMemberId}
                        onChange={(e) => setRelatedMemberId(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:border-slate-900"
                      >
                        <option value="">None (Standalone root member)</option>
                        {filteredRelatedMembers.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.fullName}
                            {m.address ? ` (${m.address})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {relationshipType === 'other' && relatedMemberId && (
                    <div>
                      <label
                        htmlFor="rel-custom"
                        className="block text-xs font-semibold text-slate-700 mb-1.5"
                      >
                        Custom Relationship Label <span className="text-rose-600">*</span>
                      </label>
                      <input
                        id="rel-custom"
                        type="text"
                        value={customLabel}
                        onChange={(e) => setCustomLabel(e.target.value)}
                        maxLength={80}
                        placeholder="e.g., Uncle, Aunt, Foster Parent"
                        required
                        className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:border-slate-900"
                      />
                    </div>
                  )}

                  {/* Co-parent option when adding a Son or Daughter to a married person */}
                  {(relationshipType === 'son' || relationshipType === 'daughter') &&
                    relatedMemberSpouse && (
                      <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={alsoLinkSpouseAsParent}
                          onChange={(e) => setAlsoLinkSpouseAsParent(e.target.checked)}
                          className="mt-0.5 rounded border-slate-300 text-slate-900"
                        />
                        <span>
                          Also link spouse <strong>{relatedMemberSpouse.fullName}</strong> as the
                          other parent so {fullName.trim() || 'the child'} descends cleanly from
                          the couple.
                        </span>
                      </label>
                    )}

                  {/* Parent chooser when adding Grandfather/Grandmother to a member with parents */}
                  {(relationshipType === 'grandfather' || relationshipType === 'grandmother') &&
                    relatedMemberParents.length > 0 && (
                      <div>
                        <label
                          htmlFor="gp-parent"
                          className="block text-xs font-semibold text-slate-700 mb-1.5"
                        >
                          Parent Side (connect grandparent above)
                        </label>
                        <select
                          id="gp-parent"
                          value={targetParentId || relatedMemberParents[0].id}
                          onChange={(e) => setTargetParentId(e.target.value)}
                          className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:border-slate-900"
                        >
                          {relatedMemberParents.map((p) => (
                            <option key={p.id} value={p.id}>
                              Parent of {p.fullName} ({p.gender === 'male' ? 'Paternal' : 'Maternal'})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                  {/* Live summary sentence */}
                  {selectedRelatedMember && (
                    <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200/80 rounded-lg px-3.5 py-2.5">
                      <strong>{fullName.trim() || 'New member'}</strong> will be added as the{' '}
                      <strong>
                        {relationshipType === 'other'
                          ? customLabel.trim() || 'relative'
                          : relationshipType}
                      </strong>{' '}
                      of <strong>{selectedRelatedMember.fullName}</strong>.
                    </p>
                  )}
                </div>
              )}

              {/* Notes */}
              <div>
                <label
                  htmlFor="member-notes"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Notes <span className="font-normal text-slate-400">(Optional)</span>
                </label>
                <textarea
                  id="member-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={1000}
                  placeholder="Nicknames, occupation, family history notes..."
                  className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:border-slate-900 resize-y"
                />
              </div>
            </>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || uploadingPhoto}
              className="px-5 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              {submitting
                ? 'Saving...'
                : mode === 'edit'
                  ? 'Save Changes'
                  : tab === 'link'
                    ? 'Connect Members'
                    : 'Add Family Member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
