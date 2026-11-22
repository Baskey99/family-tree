import type {
  DerivedRelationships,
  FamilyMember,
  FamilyRelationship,
  FormRelationshipType,
  Gender,
  RelatedMemberItem,
  StoredRelationshipType,
} from '../types/family';

/**
 * Generates a Firestore-rule-compliant ID matching ^[a-zA-Z0-9_\-]+$
 */
export function generateSafeId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'id';
  return `${cleanPrefix}_${random}`;
}

/**
 * Calculates age accurately from an ISO YYYY-MM-DD date string,
 * taking into account whether the birthday has occurred yet this year.
 */
export function calculateAgeFromDob(dob: string, referenceDate: Date = new Date()): number | null {
  if (!dob || !dob.trim()) return null;
  const parts = dob.split('-').map((p) => Number(p));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [year, month, day] = parts;
  if (year < 1850 || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const birthDate = new Date(year, month - 1, day);
  if (
    birthDate.getFullYear() !== year ||
    birthDate.getMonth() !== month - 1 ||
    birthDate.getDate() !== day
  ) {
    return null;
  }

  let age = referenceDate.getFullYear() - year;
  const monthDiff = referenceDate.getMonth() + 1 - month;
  if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < day)) {
    age -= 1;
  }
  return age >= 0 && age <= 130 ? age : null;
}

/**
 * DOB is strictly the source of truth when present; otherwise falls back to manualAge.
 */
export function getEffectiveAge(member: Pick<FamilyMember, 'dateOfBirth' | 'manualAge'>): {
  age: number | null;
  source: 'dob' | 'manual' | null;
} {
  if (member.dateOfBirth) {
    const calculated = calculateAgeFromDob(member.dateOfBirth);
    if (calculated !== null) {
      return { age: calculated, source: 'dob' };
    }
  }
  if (
    typeof member.manualAge === 'number' &&
    !Number.isNaN(member.manualAge) &&
    member.manualAge >= 0 &&
    member.manualAge <= 130
  ) {
    return { age: Math.floor(member.manualAge), source: 'manual' };
  }
  return { age: null, source: null };
}

export function formatDateReadable(dob: string): string {
  if (!dob) return '';
  const parts = dob.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return dob;
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function getInitials(fullName: string): string {
  const cleaned = fullName.replace(/\[.*?\]/g, '').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Checks whether adding a parent_child edge (parentId -> childId)
 * would introduce a cycle in the ancestry graph.
 */
export function wouldCreateParentCycle(
  parentId: string,
  childId: string,
  relationships: FamilyRelationship[]
): boolean {
  if (parentId === childId) return true;
  // Walk downwards from childId; if we can reach parentId, adding parentId -> childId creates a cycle.
  const childrenMap = new Map<string, string[]>();
  for (const rel of relationships) {
    if (rel.relationshipType === 'parent_child') {
      const arr = childrenMap.get(rel.personId) || [];
      arr.push(rel.relatedPersonId);
      childrenMap.set(rel.personId, arr);
    }
  }
  const visited = new Set<string>();
  const stack = [childId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === parentId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const kids = childrenMap.get(cur) || [];
    for (const k of kids) {
      stack.push(k);
    }
  }
  return false;
}

/**
 * Checks if an identical relationship already exists (undirected for spouse/sibling/cousin, directed for parent_child).
 */
export function hasExistingRelationship(
  personId: string,
  relatedPersonId: string,
  relationshipType: StoredRelationshipType,
  relationships: FamilyRelationship[]
): boolean {
  return relationships.some((r) => {
    if (r.relationshipType !== relationshipType) return false;
    if (relationshipType === 'parent_child') {
      return r.personId === personId && r.relatedPersonId === relatedPersonId;
    }
    return (
      (r.personId === personId && r.relatedPersonId === relatedPersonId) ||
      (r.personId === relatedPersonId && r.relatedPersonId === personId)
    );
  });
}

/**
 * Derives complete family connections for a member:
 * Parents, Spouses, Children, Siblings (shared parents + explicit),
 * Cousins (children of parents' siblings + explicit), Grandparents, Grandchildren, and Others.
 */
export function deriveMemberRelationships(
  memberId: string,
  members: FamilyMember[],
  relationships: FamilyRelationship[]
): DerivedRelationships {
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const parentRelsOf = new Map<string, { parentId: string; relId: string }[]>();
  const childRelsOf = new Map<string, { childId: string; relId: string }[]>();
  const spouseRelsOf = new Map<string, { spouseId: string; relId: string }[]>();
  const explicitSiblingRels: { otherId: string; relId: string }[] = [];
  const explicitCousinRels: { otherId: string; relId: string }[] = [];
  const otherRels: { otherId: string; relId: string; label: string }[] = [];

  for (const rel of relationships) {
    if (rel.relationshipType === 'parent_child') {
      const pList = parentRelsOf.get(rel.relatedPersonId) || [];
      pList.push({ parentId: rel.personId, relId: rel.id });
      parentRelsOf.set(rel.relatedPersonId, pList);

      const cList = childRelsOf.get(rel.personId) || [];
      cList.push({ childId: rel.relatedPersonId, relId: rel.id });
      childRelsOf.set(rel.personId, cList);
    } else if (rel.relationshipType === 'spouse') {
      const sA = spouseRelsOf.get(rel.personId) || [];
      sA.push({ spouseId: rel.relatedPersonId, relId: rel.id });
      spouseRelsOf.set(rel.personId, sA);

      const sB = spouseRelsOf.get(rel.relatedPersonId) || [];
      sB.push({ spouseId: rel.personId, relId: rel.id });
      spouseRelsOf.set(rel.relatedPersonId, sB);
    } else if (rel.relationshipType === 'sibling') {
      if (rel.personId === memberId) {
        explicitSiblingRels.push({ otherId: rel.relatedPersonId, relId: rel.id });
      } else if (rel.relatedPersonId === memberId) {
        explicitSiblingRels.push({ otherId: rel.personId, relId: rel.id });
      }
    } else if (rel.relationshipType === 'cousin') {
      if (rel.personId === memberId) {
        explicitCousinRels.push({ otherId: rel.relatedPersonId, relId: rel.id });
      } else if (rel.relatedPersonId === memberId) {
        explicitCousinRels.push({ otherId: rel.personId, relId: rel.id });
      }
    } else if (rel.relationshipType === 'other') {
      if (rel.personId === memberId) {
        otherRels.push({
          otherId: rel.relatedPersonId,
          relId: rel.id,
          label: rel.customLabel || 'Relative',
        });
      } else if (rel.relatedPersonId === memberId) {
        otherRels.push({
          otherId: rel.personId,
          relId: rel.id,
          label: rel.customLabel || 'Relative',
        });
      }
    }
  }

  // Parents
  const parents: RelatedMemberItem[] = [];
  const seenParents = new Set<string>();
  for (const { parentId, relId } of parentRelsOf.get(memberId) || []) {
    const m = memberMap.get(parentId);
    if (m && !seenParents.has(parentId)) {
      seenParents.add(parentId);
      parents.push({
        member: m,
        label: m.gender === 'male' ? 'Father' : 'Mother',
        relationshipId: relId,
        isDerived: false,
      });
    }
  }

  // Spouses
  const spouses: RelatedMemberItem[] = [];
  const seenSpouses = new Set<string>();
  for (const { spouseId, relId } of spouseRelsOf.get(memberId) || []) {
    const m = memberMap.get(spouseId);
    if (m && !seenSpouses.has(spouseId)) {
      seenSpouses.add(spouseId);
      spouses.push({
        member: m,
        label: m.gender === 'male' ? 'Husband' : 'Wife',
        relationshipId: relId,
        isDerived: false,
      });
    }
  }

  // Children (direct + via spouse if only linked to one spouse)
  const children: RelatedMemberItem[] = [];
  const seenChildren = new Set<string>();
  for (const { childId, relId } of childRelsOf.get(memberId) || []) {
    const m = memberMap.get(childId);
    if (m && !seenChildren.has(childId)) {
      seenChildren.add(childId);
      children.push({
        member: m,
        label: m.gender === 'male' ? 'Son' : 'Daughter',
        relationshipId: relId,
        isDerived: false,
      });
    }
  }

  // Siblings: derived from shared parents first, then explicit sibling links
  const siblings: RelatedMemberItem[] = [];
  const seenSiblings = new Set<string>([memberId]);
  const getSiblingsOf = (personId: string): string[] => {
    const sibIds = new Set<string>();
    const pIds = (parentRelsOf.get(personId) || []).map((p) => p.parentId);
    for (const pId of pIds) {
      for (const { childId } of childRelsOf.get(pId) || []) {
        if (childId !== personId) sibIds.add(childId);
      }
    }
    return [...sibIds];
  };

  for (const sibId of getSiblingsOf(memberId)) {
    const m = memberMap.get(sibId);
    if (m && !seenSiblings.has(sibId)) {
      seenSiblings.add(sibId);
      siblings.push({
        member: m,
        label: m.gender === 'male' ? 'Brother' : 'Sister',
        isDerived: true,
      });
    }
  }
  for (const { otherId, relId } of explicitSiblingRels) {
    const m = memberMap.get(otherId);
    if (m && !seenSiblings.has(otherId)) {
      seenSiblings.add(otherId);
      siblings.push({
        member: m,
        label: m.gender === 'male' ? 'Brother' : 'Sister',
        relationshipId: relId,
        isDerived: false,
      });
    }
  }

  // Grandparents: parents of parents
  const grandparents: RelatedMemberItem[] = [];
  const seenGrandparents = new Set<string>();
  for (const p of parents) {
    for (const { parentId } of parentRelsOf.get(p.member.id) || []) {
      const gp = memberMap.get(parentId);
      if (gp && !seenGrandparents.has(parentId)) {
        seenGrandparents.add(parentId);
        grandparents.push({
          member: gp,
          label: gp.gender === 'male' ? 'Grandfather' : 'Grandmother',
          isDerived: true,
        });
      }
    }
  }

  // Grandchildren: children of children
  const grandchildren: RelatedMemberItem[] = [];
  const seenGrandchildren = new Set<string>();
  for (const c of children) {
    for (const { childId } of childRelsOf.get(c.member.id) || []) {
      const gc = memberMap.get(childId);
      if (gc && !seenGrandchildren.has(childId)) {
        seenGrandchildren.add(childId);
        grandchildren.push({
          member: gc,
          label: gc.gender === 'male' ? 'Grandson' : 'Granddaughter',
          isDerived: true,
        });
      }
    }
  }

  // Cousins: children of parents' siblings + explicit cousin links
  const cousins: RelatedMemberItem[] = [];
  const seenCousins = new Set<string>([memberId, ...seenSiblings]);
  for (const p of parents) {
    const auntsUncles = getSiblingsOf(p.member.id);
    for (const auId of auntsUncles) {
      for (const { childId } of childRelsOf.get(auId) || []) {
        const c = memberMap.get(childId);
        if (c && !seenCousins.has(childId)) {
          seenCousins.add(childId);
          cousins.push({
            member: c,
            label: 'Cousin',
            isDerived: true,
          });
        }
      }
    }
  }
  for (const { otherId, relId } of explicitCousinRels) {
    const m = memberMap.get(otherId);
    if (m && !seenCousins.has(otherId)) {
      seenCousins.add(otherId);
      cousins.push({
        member: m,
        label: 'Cousin',
        relationshipId: relId,
        isDerived: false,
      });
    }
  }

  // Other custom relationships
  const others: RelatedMemberItem[] = [];
  for (const { otherId, relId, label } of otherRels) {
    const m = memberMap.get(otherId);
    if (m) {
      others.push({
        member: m,
        label,
        relationshipId: relId,
        isDerived: false,
      });
    }
  }

  return {
    parents,
    spouses,
    children,
    siblings,
    cousins,
    grandparents,
    grandchildren,
    others,
  };
}

export interface PlannedRelationshipEdge {
  personId: string;
  relatedPersonId: string;
  relationshipType: StoredRelationshipType;
  customLabel: string;
}

/**
 * Translates a user-chosen relationship type ("New member is [relType] of [relatedMember]")
 * into clean, normalized stored edges without duplicating members or creating cycles.
 */
export function planRelationshipsForNewMember(params: {
  newMemberId: string;
  relatedMemberId: string;
  relationshipType: FormRelationshipType;
  customLabel: string;
  alsoLinkSpouseAsParent: boolean;
  targetParentIdForGrandparent?: string;
  existingRelationships: FamilyRelationship[];
}): { edges: PlannedRelationshipEdge[]; error?: string } {
  const {
    newMemberId,
    relatedMemberId,
    relationshipType,
    customLabel,
    alsoLinkSpouseAsParent,
    targetParentIdForGrandparent,
    existingRelationships,
  } = params;

  if (!relatedMemberId || relatedMemberId === newMemberId) {
    return { edges: [] };
  }

  const edges: PlannedRelationshipEdge[] = [];

  const getParentsOf = (id: string) =>
    existingRelationships
      .filter((r) => r.relationshipType === 'parent_child' && r.relatedPersonId === id)
      .map((r) => r.personId);

  const getSpousesOf = (id: string) =>
    existingRelationships
      .filter(
        (r) =>
          r.relationshipType === 'spouse' &&
          (r.personId === id || r.relatedPersonId === id)
      )
      .map((r) => (r.personId === id ? r.relatedPersonId : r.personId));

  switch (relationshipType) {
    case 'father':
    case 'mother': {
      // New member is parent of relatedMember
      if (wouldCreateParentCycle(newMemberId, relatedMemberId, existingRelationships)) {
        return { edges: [], error: 'This parent-child link would create a circular lineage.' };
      }
      edges.push({
        personId: newMemberId,
        relatedPersonId: relatedMemberId,
        relationshipType: 'parent_child',
        customLabel: '',
      });
      // If relatedMember already has one parent of opposite/other side, optionally link as spouse only if they have no spouse yet?
      // Keep explicit: do not silently assume marriage unless desired; just establish parent_child cleanly.
      break;
    }

    case 'son':
    case 'daughter': {
      // relatedMember is parent of newMember
      if (wouldCreateParentCycle(relatedMemberId, newMemberId, existingRelationships)) {
        return { edges: [], error: 'This parent-child link would create a circular lineage.' };
      }
      edges.push({
        personId: relatedMemberId,
        relatedPersonId: newMemberId,
        relationshipType: 'parent_child',
        customLabel: '',
      });
      if (alsoLinkSpouseAsParent) {
        const spouses = getSpousesOf(relatedMemberId);
        if (spouses.length === 1) {
          edges.push({
            personId: spouses[0],
            relatedPersonId: newMemberId,
            relationshipType: 'parent_child',
            customLabel: '',
          });
        }
      }
      break;
    }

    case 'husband':
    case 'wife': {
      edges.push({
        personId: relatedMemberId,
        relatedPersonId: newMemberId,
        relationshipType: 'spouse',
        customLabel: '',
      });
      break;
    }

    case 'brother':
    case 'sister': {
      // Prefer deriving siblings from shared parents!
      const parents = getParentsOf(relatedMemberId);
      if (parents.length > 0) {
        for (const parentId of parents) {
          edges.push({
            personId: parentId,
            relatedPersonId: newMemberId,
            relationshipType: 'parent_child',
            customLabel: '',
          });
        }
      } else {
        // Fallback when relatedMember has no parents recorded yet
        edges.push({
          personId: relatedMemberId,
          relatedPersonId: newMemberId,
          relationshipType: 'sibling',
          customLabel: '',
        });
      }
      break;
    }

    case 'cousin': {
      edges.push({
        personId: relatedMemberId,
        relatedPersonId: newMemberId,
        relationshipType: 'cousin',
        customLabel: '',
      });
      break;
    }

    case 'grandfather':
    case 'grandmother': {
      const parents = getParentsOf(relatedMemberId);
      const chosenParentId =
        targetParentIdForGrandparent && parents.includes(targetParentIdForGrandparent)
          ? targetParentIdForGrandparent
          : parents[0];
      if (chosenParentId) {
        edges.push({
          personId: newMemberId,
          relatedPersonId: chosenParentId,
          relationshipType: 'parent_child',
          customLabel: '',
        });
      } else {
        edges.push({
          personId: newMemberId,
          relatedPersonId: relatedMemberId,
          relationshipType: 'other',
          customLabel: relationshipType === 'grandfather' ? 'Grandfather' : 'Grandmother',
        });
      }
      break;
    }

    case 'other': {
      edges.push({
        personId: relatedMemberId,
        relatedPersonId: newMemberId,
        relationshipType: 'other',
        customLabel: customLabel.trim() || 'Relative',
      });
      break;
    }
  }

  return { edges };
}

export function inferDefaultGenderForRelation(relType: FormRelationshipType): Gender | null {
  switch (relType) {
    case 'father':
    case 'husband':
    case 'son':
    case 'brother':
    case 'grandfather':
      return 'male';
    case 'mother':
    case 'wife':
    case 'daughter':
    case 'sister':
    case 'grandmother':
      return 'female';
    default:
      return null;
  }
}

/**
 * Compresses and center-crops an uploaded image file to a crisp 160x160 JPEG Data URL
 * strictly under 60KB for fast rendering and safe Firestore document storage.
 */
export async function compressImageToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file (JPG, PNG, or WebP).');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Image is too large. Please select an image smaller than 10 MB.');
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read the selected image file.'));
    };
    reader.onerror = () => reject(new Error('Failed to read the selected image file.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The selected image appears to be corrupted or unsupported.'));
    image.src = dataUrl;
  });

  const targetSize = 160;
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Browser canvas is unavailable for image processing.');
  }

  const minSide = Math.min(img.width, img.height);
  const sx = (img.width - minSide) / 2;
  const sy = (img.height - minSide) / 2;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetSize, targetSize);
  ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, targetSize, targetSize);

  let quality = 0.82;
  let output = canvas.toDataURL('image/jpeg', quality);
  while (output.length > 58000 && quality > 0.35) {
    quality -= 0.12;
    output = canvas.toDataURL('image/jpeg', quality);
  }
  if (output.length > 62000) {
    throw new Error('Unable to compress photo small enough for storage. Try a simpler image.');
  }
  return output;
}
