export type Gender = 'male' | 'female';

export type StoredRelationshipType =
  | 'parent_child'
  | 'spouse'
  | 'sibling'
  | 'cousin'
  | 'other';

export type FormRelationshipType =
  | 'father'
  | 'mother'
  | 'husband'
  | 'wife'
  | 'son'
  | 'daughter'
  | 'brother'
  | 'sister'
  | 'cousin'
  | 'grandfather'
  | 'grandmother'
  | 'other';

export type TreeRole = 'owner' | 'editor' | 'viewer';

export type ShareRole = 'viewer' | 'editor';

export type TreeLinkDirection = 'mutual' | 'source_is_parent' | 'target_is_parent';

export type TreeLinkRequestStatus = 'pending' | 'accepted' | 'declined';

export interface FamilyTreeRecord {
  id: string;
  ownerId: string;
  ownerName?: string;
  ownerEmail?: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  accessRole?: TreeRole;
  membershipId?: string;
}

export interface TreeInvite {
  id: string;
  treeId: string;
  treeName: string;
  ownerId: string;
  ownerName: string;
  inviteeEmail: string;
  role: ShareRole;
  createdAt: string;
  updatedAt: string;
}

export interface TreeMembership {
  id: string;
  treeId: string;
  treeName: string;
  ownerId: string;
  ownerName: string;
  userId: string;
  userEmail: string;
  userName: string;
  role: ShareRole;
  inviteId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TreeLinkRequest {
  id: string;
  sourceTreeId: string;
  sourceTreeName: string;
  sourceOwnerId: string;
  sourceOwnerName: string;
  sourceOwnerEmail: string;
  sourceMemberId: string;
  sourceMemberName: string;
  sourceGrantsRole: ShareRole;
  targetEmail: string;
  relationshipType: StoredRelationshipType;
  relationshipDirection: TreeLinkDirection;
  customLabel: string;
  note: string;
  status: TreeLinkRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TreeConnection {
  id: string;
  requestId: string;
  sourceTreeId: string;
  sourceTreeName: string;
  sourceOwnerId: string;
  sourceOwnerName: string;
  sourceOwnerEmail: string;
  sourceMemberId: string;
  sourceMemberName: string;
  sourceGrantsRole: ShareRole;
  targetTreeId: string;
  targetTreeName: string;
  targetOwnerId: string;
  targetOwnerName: string;
  targetOwnerEmail: string;
  targetMemberId: string;
  targetMemberName: string;
  targetGrantsRole: ShareRole;
  participantIds: string[];
  relationshipType: StoredRelationshipType;
  relationshipDirection: TreeLinkDirection;
  customLabel: string;
  createdAt: string;
  updatedAt: string;
}

export interface FamilyMember {
  id: string;
  treeId: string;
  ownerId: string;
  fullName: string;
  gender: Gender;
  dateOfBirth: string;
  manualAge: number | null;
  address: string;
  photoUrl: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  /** Non-persisted UI metadata used in Combined Connected Tree View */
  originTreeName?: string;
  originTreeRole?: TreeRole;
  originalMemberId?: string;
}

export interface FamilyRelationship {
  id: string;
  treeId: string;
  ownerId: string;
  personId: string;
  relatedPersonId: string;
  relationshipType: StoredRelationshipType;
  customLabel: string;
  createdAt: string;
}

export interface SeedMember {
  id: string;
  fullName: string;
  gender: Gender;
  dateOfBirth: string;
  manualAge: number | null;
  address: string;
  photoUrl: string;
  notes: string;
}

export interface SeedRelationship {
  id: string;
  personId: string;
  relatedPersonId: string;
  relationshipType: StoredRelationshipType;
  customLabel: string;
}

export interface SeedTreeTemplate {
  id: string;
  name: string;
  description: string;
  members: SeedMember[];
  relationships: SeedRelationship[];
}

export interface RelatedMemberItem {
  member: FamilyMember;
  label: string;
  relationshipId?: string;
  isDerived: boolean;
}

export interface DerivedRelationships {
  parents: RelatedMemberItem[];
  spouses: RelatedMemberItem[];
  children: RelatedMemberItem[];
  siblings: RelatedMemberItem[];
  cousins: RelatedMemberItem[];
  grandparents: RelatedMemberItem[];
  grandchildren: RelatedMemberItem[];
  others: RelatedMemberItem[];
}

export interface LayoutNode {
  member: FamilyMember;
  x: number;
  y: number;
  width: number;
  height: number;
  generation: number;
  hasChildren: boolean;
  isCollapsed: boolean;
  hiddenDescendantCount: number;
  unitId: string;
}

export interface LayoutConnector {
  id: string;
  type: 'spouse' | 'parent_child' | 'sibling' | 'cousin' | 'other';
  path: string;
  unionPoint?: { x: number; y: number };
  label?: string;
  labelPos?: { x: number; y: number };
  involvedMemberIds: string[];
}

export interface GenerationBand {
  generation: number;
  label: string;
  y: number;
  count: number;
}

export interface TreeLayoutResult {
  nodes: LayoutNode[];
  connectors: LayoutConnector[];
  generations: GenerationBand[];
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
  memberGenerationMap: Map<string, number>;
}
