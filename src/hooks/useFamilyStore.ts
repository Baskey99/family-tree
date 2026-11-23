import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { SEED_FAMILY_TREES } from '../data/seedFamilyTrees';
import {
  auth,
  db,
  handleFirestoreError,
  loginWithUsernameOrEmail,
  normalizeUsernameKey,
  OperationType,
  registerWithEmailPassword,
  sendPasswordResetForIdentifier,
  signInWithGoogle,
  signOutUser,
} from '../lib/firebase';
import {
  generateSafeId,
  hasExistingRelationship,
  planRelationshipsForNewMember,
  wouldCreateParentCycle,
} from '../lib/familyUtils';
import {
  checkRateLimit,
  recordRateLimitAttempt,
  sanitizeImageUrl,
  sanitizeSingleLine,
  sanitizeText,
} from '../lib/security';
import type {
  FamilyMember,
  FamilyRelationship,
  FamilyTreeRecord,
  FormRelationshipType,
  Gender,
  SeedTreeTemplate,
  ShareRole,
  StoredRelationshipType,
  TreeConnection,
  TreeInvite,
  TreeLinkDirection,
  TreeLinkRequest,
  TreeMembership,
  TreeRole,
} from '../types/family';

const LEGACY_LOCAL_STORAGE_KEY = 'kinship_family_tree_workspace_v1';
const LOCAL_STORAGE_KEY = 'kinship_family_tree_workspace_v2';

interface LocalWorkspaceData {
  trees: FamilyTreeRecord[];
  membersByTree: Record<string, FamilyMember[]>;
  relationshipsByTree: Record<string, FamilyRelationship[]>;
  activeTreeId: string;
}

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface MemberInputPayload {
  fullName: string;
  gender: Gender;
  dateOfBirth: string;
  manualAge: number | null;
  address: string;
  photoUrl: string;
  notes: string;
  relationship?: {
    relatedMemberId: string;
    relationshipType: FormRelationshipType;
    customLabel: string;
    alsoLinkSpouseAsParent: boolean;
    targetParentIdForGrandparent?: string;
  };
}

function formatFirestoreTimestamp(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (
    val &&
    typeof val === 'object' &&
    'toDate' in val &&
    typeof (val as { toDate: () => Date }).toDate === 'function'
  ) {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function getUserDisplayName(user: User): string {
  if (user.displayName && user.displayName.trim()) {
    return user.displayName.trim().slice(0, 120);
  }
  if (user.email) {
    return user.email.split('@')[0].slice(0, 120);
  }
  return 'Family Owner';
}

function buildSeedWorkspace(): LocalWorkspaceData {
  const now = new Date().toISOString();
  const trees: FamilyTreeRecord[] = [];
  const membersByTree: Record<string, FamilyMember[]> = {};
  const relationshipsByTree: Record<string, FamilyRelationship[]> = {};

  for (const seed of SEED_FAMILY_TREES) {
    trees.push({
      id: seed.id,
      ownerId: 'local_guest',
      ownerName: 'You',
      name: seed.name,
      description: seed.description,
      createdAt: now,
      updatedAt: now,
      accessRole: 'owner',
    });
    membersByTree[seed.id] = seed.members.map((m) => ({
      ...m,
      treeId: seed.id,
      ownerId: 'local_guest',
      createdAt: now,
      updatedAt: now,
    }));
    relationshipsByTree[seed.id] = seed.relationships.map((r) => ({
      ...r,
      treeId: seed.id,
      ownerId: 'local_guest',
      createdAt: now,
    }));
  }

  return {
    trees,
    membersByTree,
    relationshipsByTree,
    activeTreeId: trees[0]?.id || '',
  };
}

function loadLocalWorkspace(): LocalWorkspaceData {
  try {
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalWorkspaceData;
      if (Array.isArray(parsed.trees)) {
        return {
          ...parsed,
          trees: parsed.trees.map((t) => ({ ...t, accessRole: 'owner' })),
        };
      }
    }
  } catch {
    // Fall back to fresh seed
  }
  const seeded = buildSeedWorkspace();
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(seeded));
  } catch {
    // Ignore storage quota errors
  }
  return seeded;
}

function saveLocalWorkspace(data: LocalWorkspaceData): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore quota errors
  }
}

export function useFamilyStore() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [localData, setLocalData] = useState<LocalWorkspaceData>(() => loadLocalWorkspace());
  const [ownedCloudTrees, setOwnedCloudTrees] = useState<FamilyTreeRecord[]>([]);
  const [sharedCloudTrees, setSharedCloudTrees] = useState<FamilyTreeRecord[]>([]);
  const [cloudMembers, setCloudMembers] = useState<FamilyMember[]>([]);
  const [cloudRelationships, setCloudRelationships] = useState<FamilyRelationship[]>([]);

  // Sharing & Collaboration state
  const [incomingInvites, setIncomingInvites] = useState<TreeInvite[]>([]);
  const [ownedTreeCollaborators, setOwnedTreeCollaborators] = useState<TreeMembership[]>([]);
  const [ownedTreeInvites, setOwnedTreeInvites] = useState<TreeInvite[]>([]);

  // Cross-User Family Tree Connections & Mutual Consent state
  const [incomingLinkRequests, setIncomingLinkRequests] = useState<TreeLinkRequest[]>([]);
  const [outgoingLinkRequests, setOutgoingLinkRequests] = useState<TreeLinkRequest[]>([]);
  const [treeConnections, setTreeConnections] = useState<TreeConnection[]>([]);
  const [combinedViewEnabled, setCombinedViewEnabled] = useState(false);
  const [connectedTreesData, setConnectedTreesData] = useState<
    Record<string, { members: FamilyMember[]; relationships: FamilyRelationship[] }>
  >({});

  const [activeTreeId, setActiveTreeId] = useState<string>(() => localData.activeTreeId);
  const [loading, setLoading] = useState(false);
  const [seedingCloud, setSeedingCloud] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasAutoSeededRef = useRef<Set<string>>(new Set());
  const savedTimerRef = useRef<number | null>(null);

  const flashSaved = useCallback((msg: string) => {
    setSyncStatus('saved');
    setStatusMessage(msg);
    setErrorMessage(null);
    if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
    savedTimerRef.current = window.setTimeout(() => {
      setSyncStatus('idle');
      setStatusMessage('');
    }, 3400);
  }, []);

  const flashError = useCallback((msg: string) => {
    setSyncStatus('error');
    setErrorMessage(msg);
  }, []);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Import a seed template into Firestore (parent doc committed first for Master Gate rules)
  const importSeedTreeToCloud = useCallback(
    async (template: SeedTreeTemplate, currentUser: User): Promise<string> => {
      const treeId = generateSafeId(template.id.slice(0, 14));
      const treePath = `family_trees/${treeId}`;
      try {
        await setDoc(doc(db, 'family_trees', treeId), {
          ownerId: currentUser.uid,
          ownerName: getUserDisplayName(currentUser),
          ownerEmail: (currentUser.email || '').toLowerCase().slice(0, 254),
          name: template.name.slice(0, 120),
          description: template.description.slice(0, 400),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, treePath);
      }

      // Batch write members + relationships in chunks of 350 ops (Firestore limit is 500)
      let batch = writeBatch(db);
      let count = 0;

      const commitIfFull = async () => {
        if (count >= 350) {
          try {
            await batch.commit();
          } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `family_trees/${treeId}`);
          }
          batch = writeBatch(db);
          count = 0;
        }
      };

      for (const m of template.members) {
        const mRef = doc(db, 'family_trees', treeId, 'members', m.id);
        batch.set(mRef, {
          treeId,
          ownerId: currentUser.uid,
          fullName: m.fullName.slice(0, 140),
          gender: m.gender,
          dateOfBirth: m.dateOfBirth.slice(0, 32),
          manualAge: m.manualAge,
          address: m.address.slice(0, 250),
          photoUrl: m.photoUrl.slice(0, 65000),
          notes: m.notes.slice(0, 1000),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        count++;
        await commitIfFull();
      }

      for (const r of template.relationships) {
        const rRef = doc(db, 'family_trees', treeId, 'relationships', r.id);
        batch.set(rRef, {
          treeId,
          ownerId: currentUser.uid,
          personId: r.personId,
          relatedPersonId: r.relatedPersonId,
          relationshipType: r.relationshipType,
          customLabel: r.customLabel.slice(0, 80),
          createdAt: serverTimestamp(),
        });
        count++;
        await commitIfFull();
      }

      if (count > 0) {
        try {
          await batch.commit();
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `family_trees/${treeId}`);
        }
      }
      return treeId;
    },
    []
  );

  // 1. Subscribe to user's OWNED family_trees in Firestore
  useEffect(() => {
    if (!authReady || !user) {
      setOwnedCloudTrees([]);
      setSharedCloudTrees([]);
      setCloudMembers([]);
      setCloudRelationships([]);
      setIncomingInvites([]);
      setOwnedTreeCollaborators([]);
      setOwnedTreeInvites([]);
      return;
    }

    setLoading(true);
    const treesQuery = query(
      collection(db, 'family_trees'),
      where('ownerId', '==', user.uid)
    );

    const unsub = onSnapshot(
      treesQuery,
      async (snapshot) => {
        const list: FamilyTreeRecord[] = snapshot.docs
          .map((d): FamilyTreeRecord => {
            const data = d.data();
            return {
              id: d.id,
              ownerId: String(data.ownerId || ''),
              ownerName: String(data.ownerName || getUserDisplayName(user)),
              ownerEmail: String(data.ownerEmail || user.email || ''),
              name: String(data.name || 'Untitled Tree'),
              description: String(data.description || ''),
              createdAt: formatFirestoreTimestamp(data.createdAt),
              updatedAt: formatFirestoreTimestamp(data.updatedAt),
              accessRole: 'owner',
            };
          })
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

        setOwnedCloudTrees(list);

        if (list.length === 0 && !hasAutoSeededRef.current.has(user.uid)) {
          hasAutoSeededRef.current.add(user.uid);
          setSeedingCloud(true);
          try {
            let firstId = '';
            for (const seed of SEED_FAMILY_TREES) {
              const id = await importSeedTreeToCloud(seed, user);
              if (!firstId) firstId = id;
            }
            if (firstId) setActiveTreeId(firstId);
            flashSaved('Created starter sample family tree in Cloud Firestore');
          } catch (err) {
            flashError(err instanceof Error ? err.message : 'Failed to initialize cloud trees.');
          } finally {
            setSeedingCloud(false);
            setLoading(false);
          }
          return;
        }

        setLoading(false);
      },
      (error) => {
        setLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'family_trees');
      }
    );

    return () => unsub();
  }, [authReady, user, importSeedTreeToCloud, flashSaved, flashError]);

  // 2. Subscribe to SHARED trees (memberships where current user is a collaborator)
  useEffect(() => {
    if (!authReady || !user) {
      setSharedCloudTrees([]);
      return;
    }

    let cancelled = false;
    const myMembershipsQuery = query(
      collection(db, 'tree_memberships'),
      where('userId', '==', user.uid)
    );

    const unsub = onSnapshot(
      myMembershipsQuery,
      async (snap) => {
        const memberships: TreeMembership[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            treeId: String(data.treeId || ''),
            treeName: String(data.treeName || 'Shared Family Tree'),
            ownerId: String(data.ownerId || ''),
            ownerName: String(data.ownerName || 'Family Owner'),
            userId: String(data.userId || ''),
            userEmail: String(data.userEmail || ''),
            userName: String(data.userName || ''),
            role: data.role === 'editor' ? 'editor' : 'viewer',
            inviteId: String(data.inviteId || ''),
            createdAt: formatFirestoreTimestamp(data.createdAt),
            updatedAt: formatFirestoreTimestamp(data.updatedAt),
          };
        });

        const resolved = await Promise.all(
          memberships.map(async (m): Promise<FamilyTreeRecord | null> => {
            if (!m.treeId) return null;
            try {
              const treeSnap = await getDoc(doc(db, 'family_trees', m.treeId));
              if (!treeSnap.exists()) {
                return null;
              }
              const tData = treeSnap.data();
              return {
                id: treeSnap.id,
                ownerId: String(tData.ownerId || m.ownerId),
                ownerName: String(tData.ownerName || m.ownerName || 'Family Owner'),
                ownerEmail: String(tData.ownerEmail || ''),
                name: String(tData.name || m.treeName),
                description: String(tData.description || ''),
                createdAt: formatFirestoreTimestamp(tData.createdAt),
                updatedAt: formatFirestoreTimestamp(tData.updatedAt),
                accessRole: m.role,
                membershipId: m.id,
              };
            } catch {
              // If permission was just revoked or tree deleted, skip cleanly
              return null;
            }
          })
        );

        if (!cancelled) {
          const validShared = resolved
            .filter((item): item is FamilyTreeRecord => item !== null)
            .sort((a, b) => a.name.localeCompare(b.name));
          setSharedCloudTrees(validShared);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'tree_memberships');
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [authReady, user]);

  // 3. Subscribe to INCOMING pending invites for the current user's email
  useEffect(() => {
    const email = user?.email?.trim().toLowerCase();
    if (!authReady || !user || !email) {
      setIncomingInvites([]);
      return;
    }

    const q = query(
      collection(db, 'tree_invites'),
      where('inviteeEmail', '==', email)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: TreeInvite[] = snap.docs
          .map((d): TreeInvite => {
            const data = d.data();
            return {
              id: d.id,
              treeId: String(data.treeId || ''),
              treeName: String(data.treeName || 'Family Tree'),
              ownerId: String(data.ownerId || ''),
              ownerName: String(data.ownerName || 'Family Member'),
              inviteeEmail: String(data.inviteeEmail || ''),
              role: data.role === 'editor' ? 'editor' : 'viewer',
              createdAt: formatFirestoreTimestamp(data.createdAt),
              updatedAt: formatFirestoreTimestamp(data.updatedAt),
            };
          })
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setIncomingInvites(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'tree_invites');
      }
    );

    return () => unsub();
  }, [authReady, user]);

  // 4. Subscribe to COLLABORATORS & OUTGOING INVITES on trees owned by current user
  //    (Uses single-field ownerId query so zero manual composite indexes are required!)
  useEffect(() => {
    if (!authReady || !user) {
      setOwnedTreeCollaborators([]);
      setOwnedTreeInvites([]);
      return;
    }

    const collabQuery = query(
      collection(db, 'tree_memberships'),
      where('ownerId', '==', user.uid)
    );
    const outInvitesQuery = query(
      collection(db, 'tree_invites'),
      where('ownerId', '==', user.uid)
    );

    const unsubCollab = onSnapshot(
      collabQuery,
      (snap) => {
        const list: TreeMembership[] = snap.docs
          .map((d): TreeMembership => {
            const data = d.data();
            return {
              id: d.id,
              treeId: String(data.treeId || ''),
              treeName: String(data.treeName || ''),
              ownerId: String(data.ownerId || ''),
              ownerName: String(data.ownerName || ''),
              userId: String(data.userId || ''),
              userEmail: String(data.userEmail || ''),
              userName: String(data.userName || ''),
              role: data.role === 'editor' ? 'editor' : 'viewer',
              inviteId: String(data.inviteId || ''),
              createdAt: formatFirestoreTimestamp(data.createdAt),
              updatedAt: formatFirestoreTimestamp(data.updatedAt),
            };
          })
          .sort((a, b) => a.userEmail.localeCompare(b.userEmail));
        setOwnedTreeCollaborators(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'tree_memberships');
      }
    );

    const unsubInvites = onSnapshot(
      outInvitesQuery,
      (snap) => {
        const list: TreeInvite[] = snap.docs
          .map((d): TreeInvite => {
            const data = d.data();
            return {
              id: d.id,
              treeId: String(data.treeId || ''),
              treeName: String(data.treeName || ''),
              ownerId: String(data.ownerId || ''),
              ownerName: String(data.ownerName || ''),
              inviteeEmail: String(data.inviteeEmail || ''),
              role: data.role === 'editor' ? 'editor' : 'viewer',
              createdAt: formatFirestoreTimestamp(data.createdAt),
              updatedAt: formatFirestoreTimestamp(data.updatedAt),
            };
          })
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setOwnedTreeInvites(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'tree_invites');
      }
    );

    return () => {
      unsubCollab();
      unsubInvites();
    };
  }, [authReady, user]);

  // 4b. Subscribe to CROSS-USER TREE LINK REQUESTS (incoming + outgoing) and ACTIVE TREE CONNECTIONS
  useEffect(() => {
    const email = (user?.email || '').trim().toLowerCase();
    if (!authReady || !user) {
      setIncomingLinkRequests([]);
      setOutgoingLinkRequests([]);
      setTreeConnections([]);
      return;
    }

    const parseLinkRequest = (d: { id: string; data: () => Record<string, unknown> }): TreeLinkRequest => {
      const data = d.data();
      return {
        id: d.id,
        sourceTreeId: String(data.sourceTreeId || ''),
        sourceTreeName: String(data.sourceTreeName || 'Family Tree'),
        sourceOwnerId: String(data.sourceOwnerId || ''),
        sourceOwnerName: String(data.sourceOwnerName || 'Family Owner'),
        sourceOwnerEmail: String(data.sourceOwnerEmail || ''),
        sourceMemberId: String(data.sourceMemberId || ''),
        sourceMemberName: String(data.sourceMemberName || 'Family Member'),
        sourceGrantsRole: data.sourceGrantsRole === 'editor' ? 'editor' : 'viewer',
        targetEmail: String(data.targetEmail || ''),
        relationshipType: (data.relationshipType || 'spouse') as StoredRelationshipType,
        relationshipDirection: (data.relationshipDirection || 'mutual') as TreeLinkDirection,
        customLabel: String(data.customLabel || ''),
        note: String(data.note || ''),
        status:
          data.status === 'accepted' || data.status === 'declined' ? data.status : 'pending',
        createdAt: formatFirestoreTimestamp(data.createdAt),
        updatedAt: formatFirestoreTimestamp(data.updatedAt),
      };
    };

    const unsubs: (() => void)[] = [];

    if (email) {
      const inReqQuery = query(
        collection(db, 'tree_link_requests'),
        where('targetEmail', '==', email)
      );
      unsubs.push(
        onSnapshot(
          inReqQuery,
          (snap) => {
            const pending = snap.docs
              .map((d) => parseLinkRequest(d))
              .filter((r) => r.status === 'pending')
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            setIncomingLinkRequests(pending);
          },
          (error) => {
            console.warn('Could not subscribe to incoming tree_link_requests:', error);
          }
        )
      );
    } else {
      setIncomingLinkRequests([]);
    }

    const outReqQuery = query(
      collection(db, 'tree_link_requests'),
      where('sourceOwnerId', '==', user.uid)
    );
    unsubs.push(
      onSnapshot(
        outReqQuery,
        (snap) => {
          const pending = snap.docs
            .map((d) => parseLinkRequest(d))
            .filter((r) => r.status === 'pending')
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          setOutgoingLinkRequests(pending);
        },
        (error) => {
          console.warn('Could not subscribe to outgoing tree_link_requests:', error);
        }
      )
    );

    const connQuery = query(
      collection(db, 'tree_connections'),
      where('participantIds', 'array-contains', user.uid)
    );
    unsubs.push(
      onSnapshot(
        connQuery,
        (snap) => {
          const list: TreeConnection[] = snap.docs
            .map((d): TreeConnection => {
              const data = d.data();
              return {
                id: d.id,
                requestId: String(data.requestId || ''),
                sourceTreeId: String(data.sourceTreeId || ''),
                sourceTreeName: String(data.sourceTreeName || 'Family Tree'),
                sourceOwnerId: String(data.sourceOwnerId || ''),
                sourceOwnerName: String(data.sourceOwnerName || 'Family Owner'),
                sourceOwnerEmail: String(data.sourceOwnerEmail || ''),
                sourceMemberId: String(data.sourceMemberId || ''),
                sourceMemberName: String(data.sourceMemberName || 'Family Member'),
                sourceGrantsRole: data.sourceGrantsRole === 'editor' ? 'editor' : 'viewer',
                targetTreeId: String(data.targetTreeId || ''),
                targetTreeName: String(data.targetTreeName || 'Family Tree'),
                targetOwnerId: String(data.targetOwnerId || ''),
                targetOwnerName: String(data.targetOwnerName || 'Family Owner'),
                targetOwnerEmail: String(data.targetOwnerEmail || ''),
                targetMemberId: String(data.targetMemberId || ''),
                targetMemberName: String(data.targetMemberName || 'Family Member'),
                targetGrantsRole: data.targetGrantsRole === 'editor' ? 'editor' : 'viewer',
                participantIds: Array.isArray(data.participantIds)
                  ? data.participantIds.map(String)
                  : [],
                relationshipType: (data.relationshipType || 'spouse') as StoredRelationshipType,
                relationshipDirection: (data.relationshipDirection || 'mutual') as TreeLinkDirection,
                customLabel: String(data.customLabel || ''),
                createdAt: formatFirestoreTimestamp(data.createdAt),
                updatedAt: formatFirestoreTimestamp(data.updatedAt),
              };
            })
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          setTreeConnections(list);
        },
        (error) => {
          console.warn('Could not subscribe to tree_connections:', error);
        }
      )
    );

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [authReady, user]);

  // Unified cloud trees = Owned trees first, then Shared trees (deduplicated)
  const cloudTrees = useMemo(() => {
    const ownedIds = new Set(ownedCloudTrees.map((t) => t.id));
    const uniqueShared = sharedCloudTrees.filter((t) => !ownedIds.has(t.id));
    return [...ownedCloudTrees, ...uniqueShared];
  }, [ownedCloudTrees, sharedCloudTrees]);

  // Unified data selectors (Cloud when signed in, LocalStorage when browsing before sign-in)
  const isCloudMode = Boolean(user);

  const trees = useMemo(
    () => (isCloudMode ? cloudTrees : localData.trees),
    [isCloudMode, cloudTrees, localData.trees]
  );

  const effectiveActiveTreeId = useMemo(() => {
    if (trees.some((t) => t.id === activeTreeId)) return activeTreeId;
    return trees[0]?.id || '';
  }, [trees, activeTreeId]);

  const activeTree = useMemo(
    () => trees.find((t) => t.id === effectiveActiveTreeId) || null,
    [trees, effectiveActiveTreeId]
  );

  const activeTreeRole: TreeRole = useMemo(() => {
    if (!activeTree) return 'owner';
    return activeTree.accessRole || 'owner';
  }, [activeTree]);

  const isOwnerOfActiveTree = activeTreeRole === 'owner';
  const canEditActiveTree = activeTreeRole === 'owner' || activeTreeRole === 'editor';

  // 5. Subscribe to active tree's members and relationships in Firestore
  //    (No ownerId filter so accepted viewers/editors can read shared trees!)
  useEffect(() => {
    if (!authReady || !user || !effectiveActiveTreeId) {
      setCloudMembers([]);
      setCloudRelationships([]);
      return;
    }
    if (!cloudTrees.some((t) => t.id === effectiveActiveTreeId)) {
      setCloudMembers([]);
      setCloudRelationships([]);
      return;
    }

    const membersPath = `family_trees/${effectiveActiveTreeId}/members`;
    const relsPath = `family_trees/${effectiveActiveTreeId}/relationships`;

    const membersCol = collection(db, 'family_trees', effectiveActiveTreeId, 'members');
    const relsCol = collection(db, 'family_trees', effectiveActiveTreeId, 'relationships');

    const unsubMembers = onSnapshot(
      membersCol,
      (snap) => {
        const list: FamilyMember[] = snap.docs
          .map((d): FamilyMember => {
            const data = d.data();
            return {
              id: d.id,
              treeId: String(data.treeId || effectiveActiveTreeId),
              ownerId: String(data.ownerId || ''),
              fullName: String(data.fullName || ''),
              gender: data.gender === 'female' ? 'female' : 'male',
              dateOfBirth: String(data.dateOfBirth || ''),
              manualAge: typeof data.manualAge === 'number' ? data.manualAge : null,
              address: String(data.address || ''),
              photoUrl: String(data.photoUrl || ''),
              notes: String(data.notes || ''),
              createdAt: formatFirestoreTimestamp(data.createdAt),
              updatedAt: formatFirestoreTimestamp(data.updatedAt),
            };
          })
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
        setCloudMembers(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, membersPath);
      }
    );

    const unsubRels = onSnapshot(
      relsCol,
      (snap) => {
        const list: FamilyRelationship[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            treeId: String(data.treeId || effectiveActiveTreeId),
            ownerId: String(data.ownerId || ''),
            personId: String(data.personId || ''),
            relatedPersonId: String(data.relatedPersonId || ''),
            relationshipType: (data.relationshipType || 'other') as StoredRelationshipType,
            customLabel: String(data.customLabel || ''),
            createdAt: formatFirestoreTimestamp(data.createdAt),
          };
        });
        setCloudRelationships(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, relsPath);
      }
    );

    return () => {
      unsubMembers();
      unsubRels();
    };
  }, [authReady, user, effectiveActiveTreeId, cloudTrees]);

  const members = useMemo(
    () => (isCloudMode ? cloudMembers : localData.membersByTree[effectiveActiveTreeId] || []),
    [isCloudMode, cloudMembers, localData.membersByTree, effectiveActiveTreeId]
  );

  const relationships = useMemo(
    () =>
      isCloudMode
        ? cloudRelationships
        : localData.relationshipsByTree[effectiveActiveTreeId] || [],
    [isCloudMode, cloudRelationships, localData.relationshipsByTree, effectiveActiveTreeId]
  );

  // Active tree's direct cross-tree connections
  const activeTreeConnections = useMemo(
    () =>
      treeConnections.filter(
        (c) => c.sourceTreeId === effectiveActiveTreeId || c.targetTreeId === effectiveActiveTreeId
      ),
    [treeConnections, effectiveActiveTreeId]
  );

  // BFS across 2, 3, or more connected trees reachable from effectiveActiveTreeId
  // strictly limited to trees the user has verified read access to
  const reachableConnectedTreeIds = useMemo(() => {
    if (!isCloudMode || !effectiveActiveTreeId || treeConnections.length === 0) {
      return [] as string[];
    }
    const accessibleIds = new Set(cloudTrees.map((t) => t.id));
    if (!accessibleIds.has(effectiveActiveTreeId)) return [] as string[];

    const visited = new Set<string>([effectiveActiveTreeId]);
    const queue = [effectiveActiveTreeId];
    while (queue.length > 0 && visited.size < 12) {
      const cur = queue.shift()!;
      for (const conn of treeConnections) {
        if (conn.sourceTreeId === cur && accessibleIds.has(conn.targetTreeId) && !visited.has(conn.targetTreeId)) {
          visited.add(conn.targetTreeId);
          queue.push(conn.targetTreeId);
        } else if (conn.targetTreeId === cur && accessibleIds.has(conn.sourceTreeId) && !visited.has(conn.sourceTreeId)) {
          visited.add(conn.sourceTreeId);
          queue.push(conn.sourceTreeId);
        }
      }
    }
    visited.delete(effectiveActiveTreeId);
    return Array.from(visited);
  }, [isCloudMode, effectiveActiveTreeId, treeConnections, cloudTrees]);

  const reachableConnectedKey = reachableConnectedTreeIds.join('|');
  const combinedViewActive = combinedViewEnabled && reachableConnectedTreeIds.length > 0;

  // Subscribe to connected trees' members & relationships ONLY when Combined View is toggled ON
  useEffect(() => {
    if (!authReady || !user || !combinedViewEnabled || reachableConnectedTreeIds.length === 0) {
      setConnectedTreesData({});
      return;
    }

    const unsubs: (() => void)[] = [];
    for (const tid of reachableConnectedTreeIds) {
      const mCol = collection(db, 'family_trees', tid, 'members');
      const rCol = collection(db, 'family_trees', tid, 'relationships');

      unsubs.push(
        onSnapshot(
          mCol,
          (snap) => {
            const list: FamilyMember[] = snap.docs
              .map((d): FamilyMember => {
                const data = d.data();
                return {
                  id: d.id,
                  treeId: String(data.treeId || tid),
                  ownerId: String(data.ownerId || ''),
                  fullName: String(data.fullName || ''),
                  gender: data.gender === 'female' ? 'female' : 'male',
                  dateOfBirth: String(data.dateOfBirth || ''),
                  manualAge: typeof data.manualAge === 'number' ? data.manualAge : null,
                  address: String(data.address || ''),
                  photoUrl: String(data.photoUrl || ''),
                  notes: String(data.notes || ''),
                  createdAt: formatFirestoreTimestamp(data.createdAt),
                  updatedAt: formatFirestoreTimestamp(data.updatedAt),
                };
              })
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
            setConnectedTreesData((prev) => ({
              ...prev,
              [tid]: {
                members: list,
                relationships: prev[tid]?.relationships || [],
              },
            }));
          },
          (error) => {
            console.warn(`Could not read connected tree ${tid} members:`, error);
          }
        )
      );

      unsubs.push(
        onSnapshot(
          rCol,
          (snap) => {
            const list: FamilyRelationship[] = snap.docs.map((d) => {
              const data = d.data();
              return {
                id: d.id,
                treeId: String(data.treeId || tid),
                ownerId: String(data.ownerId || ''),
                personId: String(data.personId || ''),
                relatedPersonId: String(data.relatedPersonId || ''),
                relationshipType: (data.relationshipType || 'other') as StoredRelationshipType,
                customLabel: String(data.customLabel || ''),
                createdAt: formatFirestoreTimestamp(data.createdAt),
              };
            });
            setConnectedTreesData((prev) => ({
              ...prev,
              [tid]: {
                members: prev[tid]?.members || [],
                relationships: list,
              },
            }));
          },
          (error) => {
            console.warn(`Could not read connected tree ${tid} relationships:`, error);
          }
        )
      );
    }

    return () => {
      unsubs.forEach((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, user, combinedViewEnabled, reachableConnectedKey]);

  // Unified displayMembers & displayRelationships (merges connected trees + bridge edges when Combined View is ON)
  const { displayMembers, displayRelationships } = useMemo(() => {
    if (!combinedViewActive) {
      return { displayMembers: members, displayRelationships: relationships };
    }

    const treeMap = new Map(cloudTrees.map((t) => [t.id, t]));
    const includedTreeIds = new Set([effectiveActiveTreeId, ...reachableConnectedTreeIds]);

    const mergedMembers: FamilyMember[] = members.map((m) => ({
      ...m,
      originTreeName: activeTree?.name || 'Active Tree',
      originTreeRole: activeTreeRole,
      originalMemberId: m.id,
    }));

    const mergedRelationships: FamilyRelationship[] = [...relationships];

    for (const tid of reachableConnectedTreeIds) {
      const data = connectedTreesData[tid];
      if (!data) continue;
      const tRec = treeMap.get(tid);
      const tName = tRec?.name || 'Connected Tree';
      const tRole: TreeRole = tRec?.accessRole || 'viewer';

      for (const m of data.members) {
        mergedMembers.push({
          ...m,
          id: `${tid}::${m.id}`,
          originTreeName: tName,
          originTreeRole: tRole,
          originalMemberId: m.id,
        });
      }
      for (const r of data.relationships) {
        mergedRelationships.push({
          ...r,
          id: `${tid}::${r.id}`,
          personId: `${tid}::${r.personId}`,
          relatedPersonId: `${tid}::${r.relatedPersonId}`,
        });
      }
    }

    const memberIdSet = new Set(mergedMembers.map((m) => m.id));
    const mapMemberId = (tid: string, mid: string) =>
      tid === effectiveActiveTreeId ? mid : `${tid}::${mid}`;

    for (const conn of treeConnections) {
      if (!includedTreeIds.has(conn.sourceTreeId) || !includedTreeIds.has(conn.targetTreeId)) {
        continue;
      }
      const srcId = mapMemberId(conn.sourceTreeId, conn.sourceMemberId);
      const tgtId = mapMemberId(conn.targetTreeId, conn.targetMemberId);
      if (!memberIdSet.has(srcId) || !memberIdSet.has(tgtId)) continue;

      let personId = srcId;
      let relatedPersonId = tgtId;
      if (conn.relationshipType === 'parent_child' && conn.relationshipDirection === 'target_is_parent') {
        personId = tgtId;
        relatedPersonId = srcId;
      }

      mergedRelationships.push({
        id: `bridge_${conn.id}`,
        treeId: effectiveActiveTreeId,
        ownerId: conn.sourceOwnerId,
        personId,
        relatedPersonId,
        relationshipType: conn.relationshipType,
        customLabel: conn.customLabel,
        createdAt: conn.createdAt,
      });
    }

    return {
      displayMembers: mergedMembers,
      displayRelationships: mergedRelationships,
    };
  }, [
    combinedViewActive,
    members,
    relationships,
    cloudTrees,
    effectiveActiveTreeId,
    reachableConnectedTreeIds,
    activeTree?.name,
    activeTreeRole,
    connectedTreesData,
    treeConnections,
  ]);

  const selectTree = useCallback((treeId: string) => {
    setActiveTreeId(treeId);
    setLocalData((prev) => {
      const next = { ...prev, activeTreeId: treeId };
      saveLocalWorkspace(next);
      return next;
    });
  }, []);

  // --- CRUD: Trees ---
  const createTree = useCallback(
    async (name: string, description: string): Promise<string> => {
      const cleanName = name.trim().slice(0, 120);
      const cleanDesc = description.trim().slice(0, 400);
      if (!cleanName) throw new Error('Tree name is required.');

      setSyncStatus('saving');
      const newTreeId = generateSafeId('tree');

      if (user) {
        try {
          await setDoc(doc(db, 'family_trees', newTreeId), {
            ownerId: user.uid,
            ownerName: getUserDisplayName(user),
            ownerEmail: (user.email || '').toLowerCase().slice(0, 254),
            name: cleanName,
            description: cleanDesc,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          setActiveTreeId(newTreeId);
          flashSaved(`Created "${cleanName}"`);
          return newTreeId;
        } catch (error) {
          flashError('Could not create family tree.');
          handleFirestoreError(error, OperationType.CREATE, `family_trees/${newTreeId}`);
        }
      } else {
        const now = new Date().toISOString();
        const tree: FamilyTreeRecord = {
          id: newTreeId,
          ownerId: 'local_guest',
          ownerName: 'You',
          name: cleanName,
          description: cleanDesc,
          createdAt: now,
          updatedAt: now,
          accessRole: 'owner',
        };
        setLocalData((prev) => {
          const next: LocalWorkspaceData = {
            trees: [...prev.trees, tree],
            membersByTree: { ...prev.membersByTree, [newTreeId]: [] },
            relationshipsByTree: { ...prev.relationshipsByTree, [newTreeId]: [] },
            activeTreeId: newTreeId,
          };
          saveLocalWorkspace(next);
          return next;
        });
        setActiveTreeId(newTreeId);
        flashSaved(`Created "${cleanName}"`);
        return newTreeId;
      }
    },
    [user, flashSaved, flashError]
  );

  const renameTree = useCallback(
    async (treeId: string, name: string, description: string): Promise<void> => {
      const target = trees.find((t) => t.id === treeId);
      if (target && target.accessRole && target.accessRole !== 'owner') {
        throw new Error('Only the tree owner can rename this family tree.');
      }
      const cleanName = name.trim().slice(0, 120);
      const cleanDesc = description.trim().slice(0, 400);
      if (!cleanName) throw new Error('Tree name is required.');

      setSyncStatus('saving');
      if (user) {
        try {
          await updateDoc(doc(db, 'family_trees', treeId), {
            name: cleanName,
            description: cleanDesc,
            updatedAt: serverTimestamp(),
          });

          // Keep treeName synced in memberships & pending invites (best-effort)
          const matchingCollabs = ownedTreeCollaborators.filter((c) => c.treeId === treeId);
          const matchingInvites = ownedTreeInvites.filter((i) => i.treeId === treeId);
          if (matchingCollabs.length > 0 || matchingInvites.length > 0) {
            const batch = writeBatch(db);
            for (const c of matchingCollabs) {
              batch.update(doc(db, 'tree_memberships', c.id), {
                treeName: cleanName,
                updatedAt: serverTimestamp(),
              });
            }
            for (const inv of matchingInvites) {
              batch.update(doc(db, 'tree_invites', inv.id), {
                treeName: cleanName,
                updatedAt: serverTimestamp(),
              });
            }
            await batch.commit().catch(() => {});
          }

          flashSaved('Updated family tree details');
        } catch (error) {
          flashError('Could not update family tree.');
          handleFirestoreError(error, OperationType.UPDATE, `family_trees/${treeId}`);
        }
      } else {
        const now = new Date().toISOString();
        setLocalData((prev) => {
          const next: LocalWorkspaceData = {
            ...prev,
            trees: prev.trees.map((t) =>
              t.id === treeId
                ? { ...t, name: cleanName, description: cleanDesc, updatedAt: now }
                : t
            ),
          };
          saveLocalWorkspace(next);
          return next;
        });
        flashSaved('Updated family tree details');
      }
    },
    [trees, user, ownedTreeCollaborators, ownedTreeInvites, flashSaved, flashError]
  );

  const deleteTree = useCallback(
    async (treeId: string): Promise<void> => {
      const target = trees.find((t) => t.id === treeId);
      if (target && target.accessRole && target.accessRole !== 'owner') {
        throw new Error('Only the tree owner can delete this family tree.');
      }

      setSyncStatus('saving');
      if (user) {
        try {
          // Delete subcollection documents + sharing records first, then tree document
          const membersSnap = await getDocs(collection(db, 'family_trees', treeId, 'members'));
          const relsSnap = await getDocs(collection(db, 'family_trees', treeId, 'relationships'));
          const collabRefs = ownedTreeCollaborators
            .filter((c) => c.treeId === treeId)
            .map((c) => doc(db, 'tree_memberships', c.id));
          const inviteRefs = ownedTreeInvites
            .filter((i) => i.treeId === treeId)
            .map((i) => doc(db, 'tree_invites', i.id));

          const allRefs = [
            ...membersSnap.docs.map((d) => d.ref),
            ...relsSnap.docs.map((d) => d.ref),
            ...collabRefs,
            ...inviteRefs,
          ];
          for (let i = 0; i < allRefs.length; i += 350) {
            const batch = writeBatch(db);
            for (const ref of allRefs.slice(i, i + 350)) batch.delete(ref);
            await batch.commit();
          }
          await deleteDoc(doc(db, 'family_trees', treeId));
          flashSaved('Deleted family tree');
        } catch (error) {
          flashError('Could not delete family tree.');
          handleFirestoreError(error, OperationType.DELETE, `family_trees/${treeId}`);
        }
      } else {
        setLocalData((prev) => {
          const remainingTrees = prev.trees.filter((t) => t.id !== treeId);
          const { [treeId]: _m, ...restMembers } = prev.membersByTree;
          const { [treeId]: _r, ...restRels } = prev.relationshipsByTree;
          const nextActive =
            prev.activeTreeId === treeId ? remainingTrees[0]?.id || '' : prev.activeTreeId;
          const next: LocalWorkspaceData = {
            trees: remainingTrees,
            membersByTree: restMembers,
            relationshipsByTree: restRels,
            activeTreeId: nextActive,
          };
          saveLocalWorkspace(next);
          setActiveTreeId(nextActive);
          return next;
        });
        flashSaved('Deleted family tree');
      }
    },
    [trees, user, ownedTreeCollaborators, ownedTreeInvites, flashSaved, flashError]
  );

  const importTemplateTree = useCallback(
    async (templateId: string): Promise<string | null> => {
      const template = SEED_FAMILY_TREES.find((t) => t.id === templateId);
      if (!template) return null;
      setSyncStatus('saving');
      if (user) {
        try {
          const newId = await importSeedTreeToCloud(template, user);
          setActiveTreeId(newId);
          flashSaved(`Imported "${template.name}" to Cloud`);
          return newId;
        } catch (err) {
          flashError(err instanceof Error ? err.message : 'Failed to import template.');
          return null;
        }
      } else {
        const now = new Date().toISOString();
        const newId = generateSafeId(template.id.slice(0, 14));
        const newTree: FamilyTreeRecord = {
          id: newId,
          ownerId: 'local_guest',
          ownerName: 'You',
          name: template.name,
          description: template.description,
          createdAt: now,
          updatedAt: now,
          accessRole: 'owner',
        };
        setLocalData((prev) => {
          const next: LocalWorkspaceData = {
            trees: [...prev.trees, newTree],
            membersByTree: {
              ...prev.membersByTree,
              [newId]: template.members.map((m) => ({
                ...m,
                treeId: newId,
                ownerId: 'local_guest',
                createdAt: now,
                updatedAt: now,
              })),
            },
            relationshipsByTree: {
              ...prev.relationshipsByTree,
              [newId]: template.relationships.map((r) => ({
                ...r,
                treeId: newId,
                ownerId: 'local_guest',
                createdAt: now,
              })),
            },
            activeTreeId: newId,
          };
          saveLocalWorkspace(next);
          return next;
        });
        setActiveTreeId(newId);
        flashSaved(`Imported "${template.name}"`);
        return newId;
      }
    },
    [user, importSeedTreeToCloud, flashSaved, flashError]
  );

  // --- Sharing & Family Collaboration ---
  const inviteFamilyMember = useCallback(
    async (treeId: string, identifier: string, role: ShareRole): Promise<void> => {
      if (!user) {
        throw new Error('Please sign in first to share a family tree.');
      }
      const rateCheck = checkRateLimit('invite');
      if (!rateCheck.allowed) {
        throw new Error(rateCheck.message || 'Too many invitations sent. Please wait before trying again.');
      }
      const targetTree = ownedCloudTrees.find((t) => t.id === treeId);
      if (!targetTree) {
        throw new Error('Only the owner of this family tree can send invitations.');
      }

      const trimmed = sanitizeSingleLine(identifier, 254);
      if (!trimmed) {
        throw new Error('Enter your family member’s email address or username.');
      }

      recordRateLimitAttempt('invite');

      let inviteeEmail = '';
      if (trimmed.includes('@')) {
        inviteeEmail = trimmed.toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteeEmail)) {
          throw new Error('Please enter a valid email address.');
        }
      } else {
        const usernameKey = normalizeUsernameKey(trimmed);
        if (usernameKey.length < 2) {
          throw new Error('Enter a valid username (at least 2 characters) or email address.');
        }
        let lookupSnap;
        try {
          lookupSnap = await getDoc(doc(db, 'usernames', usernameKey));
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `usernames/${usernameKey}`);
        }
        if (!lookupSnap.exists()) {
          throw new Error(
            `No account found for username "${trimmed}". You can invite them directly using their email address.`
          );
        }
        const data = lookupSnap.data();
        if (!data?.email || typeof data.email !== 'string') {
          throw new Error('Could not resolve email for that username. Try entering their email.');
        }
        inviteeEmail = data.email.trim().toLowerCase();
      }

      const myEmail = (user.email || '').trim().toLowerCase();
      if (myEmail && inviteeEmail === myEmail) {
        throw new Error('You already own this family tree.');
      }

      if (
        ownedTreeCollaborators.some(
          (c) => c.treeId === treeId && c.userEmail.toLowerCase() === inviteeEmail
        )
      ) {
        throw new Error('This family member already has access to this tree.');
      }

      if (
        ownedTreeInvites.some(
          (i) => i.treeId === treeId && i.inviteeEmail.toLowerCase() === inviteeEmail
        )
      ) {
        throw new Error('An invitation is already pending for this email address.');
      }

      const inviteId = generateSafeId('inv');
      setSyncStatus('saving');
      try {
        await setDoc(doc(db, 'tree_invites', inviteId), {
          treeId: targetTree.id,
          treeName: targetTree.name.slice(0, 120),
          ownerId: user.uid,
          ownerName: getUserDisplayName(user),
          inviteeEmail: inviteeEmail.slice(0, 254),
          role,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        flashSaved(`Invited ${inviteeEmail}`);
      } catch (error) {
        flashError('Could not send invitation.');
        handleFirestoreError(error, OperationType.CREATE, `tree_invites/${inviteId}`);
      }
    },
    [user, ownedCloudTrees, ownedTreeCollaborators, ownedTreeInvites, flashSaved, flashError]
  );

  const updateInviteRole = useCallback(
    async (inviteId: string, role: ShareRole): Promise<void> => {
      if (!user) return;
      setSyncStatus('saving');
      try {
        await updateDoc(doc(db, 'tree_invites', inviteId), {
          role,
          updatedAt: serverTimestamp(),
        });
        flashSaved('Updated pending invitation permission');
      } catch (error) {
        flashError('Could not update invitation.');
        handleFirestoreError(error, OperationType.UPDATE, `tree_invites/${inviteId}`);
      }
    },
    [user, flashSaved, flashError]
  );

  const cancelInvite = useCallback(
    async (inviteId: string): Promise<void> => {
      if (!user) return;
      setSyncStatus('saving');
      try {
        await deleteDoc(doc(db, 'tree_invites', inviteId));
        flashSaved('Cancelled invitation');
      } catch (error) {
        flashError('Could not cancel invitation.');
        handleFirestoreError(error, OperationType.DELETE, `tree_invites/${inviteId}`);
      }
    },
    [user, flashSaved, flashError]
  );

  const acceptInvite = useCallback(
    async (invite: TreeInvite): Promise<void> => {
      if (!user || !user.email) {
        throw new Error('Please sign in with your invited email address to accept.');
      }
      const myEmail = user.email.trim().toLowerCase();
      const membershipId = `${invite.treeId}__${user.uid}`;
      setSyncStatus('saving');

      try {
        const existingSnap = await getDoc(doc(db, 'tree_memberships', membershipId)).catch(
          () => null
        );
        if (!existingSnap || !existingSnap.exists()) {
          await setDoc(doc(db, 'tree_memberships', membershipId), {
            treeId: invite.treeId,
            treeName: invite.treeName.slice(0, 120),
            ownerId: invite.ownerId,
            ownerName: invite.ownerName.slice(0, 120),
            userId: user.uid,
            userEmail: myEmail.slice(0, 254),
            userName: getUserDisplayName(user),
            role: invite.role,
            inviteId: invite.id,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (error) {
        flashError('Could not accept invitation.');
        handleFirestoreError(error, OperationType.CREATE, `tree_memberships/${membershipId}`);
      }

      try {
        await deleteDoc(doc(db, 'tree_invites', invite.id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `tree_invites/${invite.id}`);
      }

      setActiveTreeId(invite.treeId);
      flashSaved(`Joined "${invite.treeName}" (${invite.role === 'editor' ? 'Can edit' : 'View only'})`);
    },
    [user, flashSaved, flashError]
  );

  const declineInvite = useCallback(
    async (inviteId: string): Promise<void> => {
      if (!user) return;
      setSyncStatus('saving');
      try {
        await deleteDoc(doc(db, 'tree_invites', inviteId));
        flashSaved('Declined invitation');
      } catch (error) {
        flashError('Could not decline invitation.');
        handleFirestoreError(error, OperationType.DELETE, `tree_invites/${inviteId}`);
      }
    },
    [user, flashSaved, flashError]
  );

  const updateCollaboratorRole = useCallback(
    async (membershipId: string, role: ShareRole): Promise<void> => {
      if (!user) return;
      setSyncStatus('saving');
      try {
        await updateDoc(doc(db, 'tree_memberships', membershipId), {
          role,
          updatedAt: serverTimestamp(),
        });
        flashSaved(`Updated member access to ${role === 'editor' ? 'Editor' : 'Viewer'}`);
      } catch (error) {
        flashError('Could not update member permission.');
        handleFirestoreError(error, OperationType.UPDATE, `tree_memberships/${membershipId}`);
      }
    },
    [user, flashSaved, flashError]
  );

  const revokeCollaborator = useCallback(
    async (membershipId: string): Promise<void> => {
      if (!user) return;
      setSyncStatus('saving');
      try {
        await deleteDoc(doc(db, 'tree_memberships', membershipId));
        flashSaved('Revoked family member access');
      } catch (error) {
        flashError('Could not revoke access.');
        handleFirestoreError(error, OperationType.DELETE, `tree_memberships/${membershipId}`);
      }
    },
    [user, flashSaved, flashError]
  );

  const leaveSharedTree = useCallback(
    async (membershipId: string): Promise<void> => {
      if (!user) return;
      setSyncStatus('saving');
      try {
        await deleteDoc(doc(db, 'tree_memberships', membershipId));
        flashSaved('Left shared family tree');
      } catch (error) {
        flashError('Could not leave shared family tree.');
        handleFirestoreError(error, OperationType.DELETE, `tree_memberships/${membershipId}`);
      }
    },
    [user, flashSaved, flashError]
  );

  const getCollaboratorsForTree = useCallback(
    (treeId: string) => ownedTreeCollaborators.filter((c) => c.treeId === treeId),
    [ownedTreeCollaborators]
  );

  const getInvitesForTree = useCallback(
    (treeId: string) => ownedTreeInvites.filter((i) => i.treeId === treeId),
    [ownedTreeInvites]
  );

  // --- CRUD: Members ---
  const addMember = useCallback(
    async (payload: MemberInputPayload): Promise<string> => {
      if (activeTree && !canEditActiveTree) {
        throw new Error('You have view-only access to this family tree.');
      }

      let targetTreeId = effectiveActiveTreeId;
      let treeOwnerId = activeTree?.ownerId || user?.uid || 'local_guest';
      if (!targetTreeId) {
        targetTreeId = await createTree('My Family Tree', 'Personal family lineage.');
        treeOwnerId = user?.uid || 'local_guest';
      }

      const fullName = payload.fullName.trim().slice(0, 140);
      if (!fullName) throw new Error('Full Name is required.');

      const newMemberId = generateSafeId('mem');

      // Validate and plan relationships
      const plannedEdges = payload.relationship?.relatedMemberId
        ? planRelationshipsForNewMember({
            newMemberId,
            relatedMemberId: payload.relationship.relatedMemberId,
            relationshipType: payload.relationship.relationshipType,
            customLabel: payload.relationship.customLabel,
            alsoLinkSpouseAsParent: payload.relationship.alsoLinkSpouseAsParent,
            targetParentIdForGrandparent: payload.relationship.targetParentIdForGrandparent,
            existingRelationships: relationships,
          })
        : { edges: [] };

      if (plannedEdges.error) {
        throw new Error(plannedEdges.error);
      }

      const normalizedDob = payload.dateOfBirth.trim().slice(0, 32);
      const normalizedManualAge =
        normalizedDob !== ''
          ? null
          : payload.manualAge !== null && !Number.isNaN(payload.manualAge)
            ? Math.max(0, Math.min(130, Math.floor(payload.manualAge)))
            : null;

      const safeFullName = sanitizeSingleLine(fullName, 140);
      const safeAddress = sanitizeSingleLine(payload.address, 250);
      const safePhotoUrl = sanitizeImageUrl(payload.photoUrl);
      const safeNotes = sanitizeText(payload.notes, 1000);

      setSyncStatus('saving');

      if (user) {
        try {
          const batch = writeBatch(db);
          const mRef = doc(db, 'family_trees', targetTreeId, 'members', newMemberId);
          batch.set(mRef, {
            treeId: targetTreeId,
            ownerId: treeOwnerId,
            fullName: safeFullName,
            gender: payload.gender,
            dateOfBirth: normalizedDob,
            manualAge: normalizedManualAge,
            address: safeAddress,
            photoUrl: safePhotoUrl,
            notes: safeNotes,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          for (const edge of plannedEdges.edges) {
            if (
              hasExistingRelationship(
                edge.personId,
                edge.relatedPersonId,
                edge.relationshipType,
                relationships
              )
            ) {
              continue;
            }
            const relId = generateSafeId('rel');
            const rRef = doc(db, 'family_trees', targetTreeId, 'relationships', relId);
            batch.set(rRef, {
              treeId: targetTreeId,
              ownerId: treeOwnerId,
              personId: edge.personId,
              relatedPersonId: edge.relatedPersonId,
              relationshipType: edge.relationshipType,
              customLabel: edge.customLabel.slice(0, 80),
              createdAt: serverTimestamp(),
            });
          }

          await batch.commit();
          flashSaved(`Added ${fullName}`);
          return newMemberId;
        } catch (error) {
          flashError('Failed to save family member.');
          handleFirestoreError(
            error,
            OperationType.CREATE,
            `family_trees/${targetTreeId}/members/${newMemberId}`
          );
        }
      } else {
        const now = new Date().toISOString();
        const newMember: FamilyMember = {
          id: newMemberId,
          treeId: targetTreeId,
          ownerId: 'local_guest',
          fullName: safeFullName,
          gender: payload.gender,
          dateOfBirth: normalizedDob,
          manualAge: normalizedManualAge,
          address: safeAddress,
          photoUrl: safePhotoUrl,
          notes: safeNotes,
          createdAt: now,
          updatedAt: now,
        };

        const newRels: FamilyRelationship[] = plannedEdges.edges
          .filter(
            (edge) =>
              !hasExistingRelationship(
                edge.personId,
                edge.relatedPersonId,
                edge.relationshipType,
                relationships
              )
          )
          .map((edge) => ({
            id: generateSafeId('rel'),
            treeId: targetTreeId,
            ownerId: 'local_guest',
            personId: edge.personId,
            relatedPersonId: edge.relatedPersonId,
            relationshipType: edge.relationshipType,
            customLabel: edge.customLabel.slice(0, 80),
            createdAt: now,
          }));

        setLocalData((prev) => {
          const next: LocalWorkspaceData = {
            ...prev,
            membersByTree: {
              ...prev.membersByTree,
              [targetTreeId]: [...(prev.membersByTree[targetTreeId] || []), newMember],
            },
            relationshipsByTree: {
              ...prev.relationshipsByTree,
              [targetTreeId]: [...(prev.relationshipsByTree[targetTreeId] || []), ...newRels],
            },
          };
          saveLocalWorkspace(next);
          return next;
        });
        flashSaved(`Added ${fullName}`);
        return newMemberId;
      }
    },
    [
      activeTree,
      canEditActiveTree,
      effectiveActiveTreeId,
      createTree,
      relationships,
      user,
      flashSaved,
      flashError,
    ]
  );

  const updateMember = useCallback(
    async (
      memberId: string,
      updates: Omit<MemberInputPayload, 'relationship'>
    ): Promise<void> => {
      if (!effectiveActiveTreeId) return;
      if (!canEditActiveTree) {
        throw new Error('You have view-only access to this family tree.');
      }
      const fullName = sanitizeSingleLine(updates.fullName, 140);
      if (!fullName) throw new Error('Full Name is required.');

      const safeAddress = sanitizeSingleLine(updates.address, 250);
      const safePhotoUrl = sanitizeImageUrl(updates.photoUrl);
      const safeNotes = sanitizeText(updates.notes, 1000);
      const normalizedDob = sanitizeSingleLine(updates.dateOfBirth, 32);
      const normalizedManualAge =
        normalizedDob !== ''
          ? null
          : updates.manualAge !== null && !Number.isNaN(updates.manualAge)
            ? Math.max(0, Math.min(130, Math.floor(updates.manualAge)))
            : null;

      setSyncStatus('saving');

      if (user) {
        const path = `family_trees/${effectiveActiveTreeId}/members/${memberId}`;
        try {
          await updateDoc(doc(db, 'family_trees', effectiveActiveTreeId, 'members', memberId), {
            fullName,
            gender: updates.gender,
            dateOfBirth: normalizedDob,
            manualAge: normalizedManualAge,
            address: safeAddress,
            photoUrl: safePhotoUrl,
            notes: safeNotes,
            updatedAt: serverTimestamp(),
          });
          flashSaved(`Saved changes to ${fullName}`);
        } catch (error) {
          flashError('Failed to update member profile.');
          handleFirestoreError(error, OperationType.UPDATE, path);
        }
      } else {
        const now = new Date().toISOString();
        setLocalData((prev) => {
          const cur = prev.membersByTree[effectiveActiveTreeId] || [];
          const next: LocalWorkspaceData = {
            ...prev,
            membersByTree: {
              ...prev.membersByTree,
              [effectiveActiveTreeId]: cur.map((m) =>
                m.id === memberId
                  ? {
                      ...m,
                      fullName,
                      gender: updates.gender,
                      dateOfBirth: normalizedDob,
                      manualAge: normalizedManualAge,
                      address: safeAddress,
                      photoUrl: safePhotoUrl,
                      notes: safeNotes,
                      updatedAt: now,
                    }
                  : m
              ),
            },
          };
          saveLocalWorkspace(next);
          return next;
        });
        flashSaved(`Saved changes to ${fullName}`);
      }
    },
    [effectiveActiveTreeId, canEditActiveTree, user, flashSaved, flashError]
  );

  const deleteMember = useCallback(
    async (memberId: string): Promise<void> => {
      if (!effectiveActiveTreeId) return;
      if (!canEditActiveTree) {
        throw new Error('You have view-only access to this family tree.');
      }
      const target = members.find((m) => m.id === memberId);
      const attachedRels = relationships.filter(
        (r) => r.personId === memberId || r.relatedPersonId === memberId
      );

      setSyncStatus('saving');

      if (user) {
        try {
          const batch = writeBatch(db);
          batch.delete(doc(db, 'family_trees', effectiveActiveTreeId, 'members', memberId));
          for (const rel of attachedRels) {
            batch.delete(doc(db, 'family_trees', effectiveActiveTreeId, 'relationships', rel.id));
          }
          await batch.commit();
          flashSaved(
            `Removed ${target?.fullName || 'member'} and ${attachedRels.length} connection(s)`
          );
        } catch (error) {
          flashError('Failed to delete family member.');
          handleFirestoreError(
            error,
            OperationType.DELETE,
            `family_trees/${effectiveActiveTreeId}/members/${memberId}`
          );
        }
      } else {
        setLocalData((prev) => {
          const curMembers = prev.membersByTree[effectiveActiveTreeId] || [];
          const curRels = prev.relationshipsByTree[effectiveActiveTreeId] || [];
          const next: LocalWorkspaceData = {
            ...prev,
            membersByTree: {
              ...prev.membersByTree,
              [effectiveActiveTreeId]: curMembers.filter((m) => m.id !== memberId),
            },
            relationshipsByTree: {
              ...prev.relationshipsByTree,
              [effectiveActiveTreeId]: curRels.filter(
                (r) => r.personId !== memberId && r.relatedPersonId !== memberId
              ),
            },
          };
          saveLocalWorkspace(next);
          return next;
        });
        flashSaved(`Removed ${target?.fullName || 'member'}`);
      }
    },
    [effectiveActiveTreeId, canEditActiveTree, members, relationships, user, flashSaved, flashError]
  );

  // --- CRUD: Direct Relationships ---
  const linkExistingMembers = useCallback(
    async (
      personId: string,
      relatedPersonId: string,
      relationshipType: StoredRelationshipType,
      customLabel = ''
    ): Promise<void> => {
      if (!effectiveActiveTreeId) return;
      if (!canEditActiveTree) {
        throw new Error('You have view-only access to this family tree.');
      }
      if (personId === relatedPersonId) {
        throw new Error('Cannot link a member to themselves.');
      }
      if (
        relationshipType === 'parent_child' &&
        wouldCreateParentCycle(personId, relatedPersonId, relationships)
      ) {
        throw new Error('This parent-child link would create a circular ancestry loop.');
      }
      if (hasExistingRelationship(personId, relatedPersonId, relationshipType, relationships)) {
        throw new Error('This relationship already exists.');
      }

      const relId = generateSafeId('rel');
      const treeOwnerId = activeTree?.ownerId || user?.uid || 'local_guest';
      setSyncStatus('saving');

      if (user) {
        const path = `family_trees/${effectiveActiveTreeId}/relationships/${relId}`;
        try {
          await setDoc(doc(db, 'family_trees', effectiveActiveTreeId, 'relationships', relId), {
            treeId: effectiveActiveTreeId,
            ownerId: treeOwnerId,
            personId,
            relatedPersonId,
            relationshipType,
            customLabel: customLabel.trim().slice(0, 80),
            createdAt: serverTimestamp(),
          });
          flashSaved('Added relationship connection');
        } catch (error) {
          flashError('Failed to add relationship.');
          handleFirestoreError(error, OperationType.CREATE, path);
        }
      } else {
        const now = new Date().toISOString();
        const newRel: FamilyRelationship = {
          id: relId,
          treeId: effectiveActiveTreeId,
          ownerId: 'local_guest',
          personId,
          relatedPersonId,
          relationshipType,
          customLabel: customLabel.trim().slice(0, 80),
          createdAt: now,
        };
        setLocalData((prev) => {
          const curRels = prev.relationshipsByTree[effectiveActiveTreeId] || [];
          const next: LocalWorkspaceData = {
            ...prev,
            relationshipsByTree: {
              ...prev.relationshipsByTree,
              [effectiveActiveTreeId]: [...curRels, newRel],
            },
          };
          saveLocalWorkspace(next);
          return next;
        });
        flashSaved('Added relationship connection');
      }
    },
    [
      effectiveActiveTreeId,
      canEditActiveTree,
      activeTree,
      relationships,
      user,
      flashSaved,
      flashError,
    ]
  );

  const deleteRelationship = useCallback(
    async (relationshipId: string): Promise<void> => {
      if (!effectiveActiveTreeId) return;
      if (!canEditActiveTree) {
        throw new Error('You have view-only access to this family tree.');
      }
      setSyncStatus('saving');
      if (user) {
        const path = `family_trees/${effectiveActiveTreeId}/relationships/${relationshipId}`;
        try {
          await deleteDoc(
            doc(db, 'family_trees', effectiveActiveTreeId, 'relationships', relationshipId)
          );
          flashSaved('Removed relationship link');
        } catch (error) {
          flashError('Failed to remove relationship link.');
          handleFirestoreError(error, OperationType.DELETE, path);
        }
      } else {
        setLocalData((prev) => {
          const curRels = prev.relationshipsByTree[effectiveActiveTreeId] || [];
          const next: LocalWorkspaceData = {
            ...prev,
            relationshipsByTree: {
              ...prev.relationshipsByTree,
              [effectiveActiveTreeId]: curRels.filter((r) => r.id !== relationshipId),
            },
          };
          saveLocalWorkspace(next);
          return next;
        });
        flashSaved('Removed relationship link');
      }
    },
    [effectiveActiveTreeId, canEditActiveTree, user, flashSaved, flashError]
  );

  // --- Cross-User Family Tree Connections (Mutual Consent for View/Edit) ---
  const fetchMembersForTree = useCallback(
    async (treeId: string): Promise<FamilyMember[]> => {
      if (!treeId) return [];
      if (!user) {
        return localData.membersByTree[treeId] || [];
      }
      if (treeId === effectiveActiveTreeId) {
        return cloudMembers;
      }
      try {
        const snap = await getDocs(collection(db, 'family_trees', treeId, 'members'));
        return snap.docs
          .map((d): FamilyMember => {
            const data = d.data();
            return {
              id: d.id,
              treeId: String(data.treeId || treeId),
              ownerId: String(data.ownerId || ''),
              fullName: String(data.fullName || ''),
              gender: data.gender === 'female' ? 'female' : 'male',
              dateOfBirth: String(data.dateOfBirth || ''),
              manualAge: typeof data.manualAge === 'number' ? data.manualAge : null,
              address: String(data.address || ''),
              photoUrl: String(data.photoUrl || ''),
              notes: String(data.notes || ''),
              createdAt: formatFirestoreTimestamp(data.createdAt),
              updatedAt: formatFirestoreTimestamp(data.updatedAt),
            };
          })
          .sort((a, b) => a.fullName.localeCompare(b.fullName));
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, `family_trees/${treeId}/members`);
      }
    },
    [user, localData.membersByTree, effectiveActiveTreeId, cloudMembers]
  );

  const sendTreeLinkRequest = useCallback(
    async (params: {
      sourceTreeId: string;
      sourceMemberId: string;
      sourceMemberName: string;
      targetIdentifier: string;
      relationshipType: StoredRelationshipType;
      relationshipDirection: TreeLinkDirection;
      customLabel?: string;
      sourceGrantsRole: ShareRole;
      note?: string;
    }): Promise<void> => {
      if (!user) {
        throw new Error('Please sign in first to connect with another user’s family tree.');
      }
      const rateCheck = checkRateLimit('tree_link');
      if (!rateCheck.allowed) {
        throw new Error(
          rateCheck.message || 'Too many connection requests sent. Please wait before trying again.'
        );
      }
      const sourceTree = ownedCloudTrees.find((t) => t.id === params.sourceTreeId);
      if (!sourceTree) {
        throw new Error('You can only initiate a tree connection from a family tree you own.');
      }

      const myEmail = (user.email || '').trim().toLowerCase();
      if (!myEmail) {
        throw new Error('Your account needs an email address to connect family trees.');
      }

      const trimmedTarget = sanitizeSingleLine(params.targetIdentifier, 254);
      if (!trimmedTarget) {
        throw new Error('Enter the other family tree owner’s email address or username.');
      }

      recordRateLimitAttempt('tree_link');

      let targetEmail = '';
      if (trimmedTarget.includes('@')) {
        targetEmail = trimmedTarget.toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
          throw new Error('Please enter a valid email address.');
        }
      } else {
        const usernameKey = normalizeUsernameKey(trimmedTarget);
        if (usernameKey.length < 2) {
          throw new Error('Enter a valid username (at least 2 characters) or email address.');
        }
        let lookupSnap;
        try {
          lookupSnap = await getDoc(doc(db, 'usernames', usernameKey));
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `usernames/${usernameKey}`);
        }
        if (!lookupSnap.exists()) {
          throw new Error(
            `No account found for username "${trimmedTarget}". Try entering their email address directly.`
          );
        }
        const data = lookupSnap.data();
        if (!data?.email || typeof data.email !== 'string') {
          throw new Error('Could not resolve email for that username. Enter their email directly.');
        }
        targetEmail = data.email.trim().toLowerCase();
      }

      if (targetEmail === myEmail) {
        throw new Error('Enter another user’s email or username to connect across accounts.');
      }

      const duplicatePending = outgoingLinkRequests.some(
        (r) =>
          r.sourceTreeId === params.sourceTreeId &&
          r.sourceMemberId === params.sourceMemberId &&
          r.targetEmail.toLowerCase() === targetEmail &&
          r.status === 'pending'
      );
      if (duplicatePending) {
        throw new Error(`A connection request is already pending for ${targetEmail}.`);
      }

      const requestId = generateSafeId('tlink');
      const cleanMemberName = sanitizeSingleLine(params.sourceMemberName, 140);
      const cleanCustomLabel = sanitizeSingleLine(params.customLabel || '', 80);
      const cleanNote = sanitizeSingleLine(params.note || '', 300);

      setSyncStatus('saving');
      try {
        await setDoc(doc(db, 'tree_link_requests', requestId), {
          sourceTreeId: sourceTree.id,
          sourceTreeName: sanitizeSingleLine(sourceTree.name, 120),
          sourceOwnerId: user.uid,
          sourceOwnerName: sanitizeSingleLine(getUserDisplayName(user), 120),
          sourceOwnerEmail: myEmail,
          sourceMemberId: params.sourceMemberId,
          sourceMemberName: cleanMemberName,
          sourceGrantsRole: params.sourceGrantsRole,
          targetEmail,
          relationshipType: params.relationshipType,
          relationshipDirection: params.relationshipDirection,
          customLabel: cleanCustomLabel,
          note: cleanNote,
          status: 'pending',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        flashSaved(`Connection request sent to ${targetEmail}`);
      } catch (error) {
        flashError('Failed to send tree connection request.');
        handleFirestoreError(error, OperationType.CREATE, `tree_link_requests/${requestId}`);
      }
    },
    [user, ownedCloudTrees, outgoingLinkRequests, flashSaved, flashError]
  );

  const acceptTreeLinkRequest = useCallback(
    async (params: {
      request: TreeLinkRequest;
      targetTreeId: string;
      targetMemberId: string;
      targetMemberName: string;
      targetGrantsRole: ShareRole;
    }): Promise<void> => {
      if (!user) throw new Error('Please sign in first.');
      const myEmail = (user.email || '').trim().toLowerCase();
      if (!myEmail) throw new Error('Your account requires an email address.');

      const targetTree = ownedCloudTrees.find((t) => t.id === params.targetTreeId);
      if (!targetTree) {
        throw new Error('Select one of your own family trees to connect.');
      }
      if (targetTree.id === params.request.sourceTreeId) {
        throw new Error('Cannot connect a family tree to itself.');
      }
      if (params.request.sourceOwnerId === user.uid) {
        throw new Error('Cannot approve your own connection request.');
      }

      const myName = sanitizeSingleLine(getUserDisplayName(user), 120);
      const cleanTargetMemberName = sanitizeSingleLine(params.targetMemberName, 140);
      const connectionId = generateSafeId('tconn');

      // Deterministic membership doc IDs for both directions
      const sourceMemId = `${params.request.sourceTreeId}__${user.uid}`;
      const targetMemId = `${targetTree.id}__${params.request.sourceOwnerId}`;

      setSyncStatus('saving');
      try {
        // Check if either directional membership already exists so we set vs update cleanly
        const [existingSourceMem, existingTargetMem] = await Promise.all([
          getDoc(doc(db, 'tree_memberships', sourceMemId)),
          getDoc(doc(db, 'tree_memberships', targetMemId)),
        ]);

        const batch = writeBatch(db);

        // 1. Mark request accepted
        batch.update(doc(db, 'tree_link_requests', params.request.id), {
          status: 'accepted',
          updatedAt: serverTimestamp(),
        });

        // 2. Grant Recipient (current user) consented access to Source Owner's tree
        if (existingSourceMem.exists()) {
          batch.update(doc(db, 'tree_memberships', sourceMemId), {
            role: params.request.sourceGrantsRole,
            treeName: sanitizeSingleLine(params.request.sourceTreeName, 120),
            inviteId: params.request.id,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(doc(db, 'tree_memberships', sourceMemId), {
            treeId: params.request.sourceTreeId,
            treeName: sanitizeSingleLine(params.request.sourceTreeName, 120),
            ownerId: params.request.sourceOwnerId,
            ownerName: sanitizeSingleLine(params.request.sourceOwnerName, 120),
            userId: user.uid,
            userEmail: myEmail,
            userName: myName,
            role: params.request.sourceGrantsRole,
            inviteId: params.request.id,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        // 3. Grant Source Owner consented access to Recipient's (current user's) tree
        if (existingTargetMem.exists()) {
          batch.update(doc(db, 'tree_memberships', targetMemId), {
            role: params.targetGrantsRole,
            treeName: sanitizeSingleLine(targetTree.name, 120),
            inviteId: params.request.id,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(doc(db, 'tree_memberships', targetMemId), {
            treeId: targetTree.id,
            treeName: sanitizeSingleLine(targetTree.name, 120),
            ownerId: user.uid,
            ownerName: myName,
            userId: params.request.sourceOwnerId,
            userEmail: params.request.sourceOwnerEmail.toLowerCase(),
            userName: sanitizeSingleLine(params.request.sourceOwnerName, 120),
            role: params.targetGrantsRole,
            inviteId: params.request.id,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        // 4. Create the active mutually-consented TreeConnection bridge
        batch.set(doc(db, 'tree_connections', connectionId), {
          requestId: params.request.id,
          sourceTreeId: params.request.sourceTreeId,
          sourceTreeName: sanitizeSingleLine(params.request.sourceTreeName, 120),
          sourceOwnerId: params.request.sourceOwnerId,
          sourceOwnerName: sanitizeSingleLine(params.request.sourceOwnerName, 120),
          sourceOwnerEmail: params.request.sourceOwnerEmail.toLowerCase(),
          sourceMemberId: params.request.sourceMemberId,
          sourceMemberName: sanitizeSingleLine(params.request.sourceMemberName, 140),
          sourceGrantsRole: params.request.sourceGrantsRole,
          targetTreeId: targetTree.id,
          targetTreeName: sanitizeSingleLine(targetTree.name, 120),
          targetOwnerId: user.uid,
          targetOwnerName: myName,
          targetOwnerEmail: myEmail,
          targetMemberId: params.targetMemberId,
          targetMemberName: cleanTargetMemberName,
          targetGrantsRole: params.targetGrantsRole,
          participantIds: [params.request.sourceOwnerId, user.uid],
          relationshipType: params.request.relationshipType,
          relationshipDirection: params.request.relationshipDirection,
          customLabel: sanitizeSingleLine(params.request.customLabel, 80),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        await batch.commit();
        setActiveTreeId(targetTree.id);
        setCombinedViewEnabled(true);
        flashSaved(
          `Connected "${targetTree.name}" with "${params.request.sourceTreeName}"!`
        );
      } catch (error) {
        flashError('Could not complete tree connection.');
        handleFirestoreError(error, OperationType.WRITE, `tree_connections/${connectionId}`);
      }
    },
    [user, ownedCloudTrees, flashSaved, flashError]
  );

  const declineTreeLinkRequest = useCallback(
    async (requestId: string): Promise<void> => {
      if (!user) return;
      setSyncStatus('saving');
      try {
        await updateDoc(doc(db, 'tree_link_requests', requestId), {
          status: 'declined',
          updatedAt: serverTimestamp(),
        });
        flashSaved('Connection request declined');
      } catch (error) {
        flashError('Failed to decline connection request.');
        handleFirestoreError(error, OperationType.UPDATE, `tree_link_requests/${requestId}`);
      }
    },
    [user, flashSaved, flashError]
  );

  const cancelTreeLinkRequest = useCallback(
    async (requestId: string): Promise<void> => {
      if (!user) return;
      setSyncStatus('saving');
      try {
        await deleteDoc(doc(db, 'tree_link_requests', requestId));
        flashSaved('Connection request cancelled');
      } catch (error) {
        flashError('Failed to cancel connection request.');
        handleFirestoreError(error, OperationType.DELETE, `tree_link_requests/${requestId}`);
      }
    },
    [user, flashSaved, flashError]
  );

  const updateConnectionPermission = useCallback(
    async (connection: TreeConnection, newRoleForMyTree: ShareRole): Promise<void> => {
      if (!user) return;
      const isSourceOwner = connection.sourceOwnerId === user.uid;
      const isTargetOwner = connection.targetOwnerId === user.uid;
      if (!isSourceOwner && !isTargetOwner) {
        throw new Error('Only a connected tree owner can change consent permissions.');
      }

      const myTreeId = isSourceOwner ? connection.sourceTreeId : connection.targetTreeId;
      const otherUid = isSourceOwner ? connection.targetOwnerId : connection.sourceOwnerId;
      const membershipId = `${myTreeId}__${otherUid}`;

      setSyncStatus('saving');
      try {
        const batch = writeBatch(db);
        batch.update(doc(db, 'tree_connections', connection.id), {
          ...(isSourceOwner
            ? { sourceGrantsRole: newRoleForMyTree }
            : { targetGrantsRole: newRoleForMyTree }),
          updatedAt: serverTimestamp(),
        });

        const memSnap = await getDoc(doc(db, 'tree_memberships', membershipId));
        if (memSnap.exists()) {
          batch.update(doc(db, 'tree_memberships', membershipId), {
            role: newRoleForMyTree,
            updatedAt: serverTimestamp(),
          });
        }

        await batch.commit();
        flashSaved(
          `Updated permission on your tree to ${newRoleForMyTree === 'editor' ? 'Can view & edit' : 'View only'}`
        );
      } catch (error) {
        flashError('Failed to update tree connection permission.');
        handleFirestoreError(error, OperationType.UPDATE, `tree_connections/${connection.id}`);
      }
    },
    [user, flashSaved, flashError]
  );

  const disconnectTrees = useCallback(
    async (connection: TreeConnection): Promise<void> => {
      if (!user) return;
      setSyncStatus('saving');
      try {
        // Check if another active connection still links the same pair of trees
        const remainingLinks = treeConnections.filter((c) => c.id !== connection.id);
        const stillNeedsSourceMem = remainingLinks.some(
          (c) =>
            (c.sourceTreeId === connection.sourceTreeId &&
              c.targetOwnerId === connection.targetOwnerId) ||
            (c.targetTreeId === connection.sourceTreeId &&
              c.sourceOwnerId === connection.targetOwnerId)
        );
        const stillNeedsTargetMem = remainingLinks.some(
          (c) =>
            (c.targetTreeId === connection.targetTreeId &&
              c.sourceOwnerId === connection.sourceOwnerId) ||
            (c.sourceTreeId === connection.targetTreeId &&
              c.targetOwnerId === connection.sourceOwnerId)
        );

        const batch = writeBatch(db);
        batch.delete(doc(db, 'tree_connections', connection.id));

        if (!stillNeedsSourceMem) {
          const sourceMemId = `${connection.sourceTreeId}__${connection.targetOwnerId}`;
          const snap = await getDoc(doc(db, 'tree_memberships', sourceMemId));
          if (snap.exists()) {
            batch.delete(doc(db, 'tree_memberships', sourceMemId));
          }
        }

        if (!stillNeedsTargetMem) {
          const targetMemId = `${connection.targetTreeId}__${connection.sourceOwnerId}`;
          const snap = await getDoc(doc(db, 'tree_memberships', targetMemId));
          if (snap.exists()) {
            batch.delete(doc(db, 'tree_memberships', targetMemId));
          }
        }

        await batch.commit();
        flashSaved('Disconnected family trees and revoked cross-tree access');
      } catch (error) {
        flashError('Failed to disconnect family trees.');
        handleFirestoreError(error, OperationType.DELETE, `tree_connections/${connection.id}`);
      }
    },
    [user, treeConnections, flashSaved, flashError]
  );

  const handleLogin = useCallback(
    async (identifier: string, password: string) => {
      setErrorMessage(null);
      await loginWithUsernameOrEmail(identifier, password);
      flashSaved('Signed in successfully');
    },
    [flashSaved]
  );

  const handleRegister = useCallback(
    async (params: {
      name: string;
      username?: string;
      email: string;
      password: string;
    }) => {
      setErrorMessage(null);
      await registerWithEmailPassword(params);
      flashSaved(`Welcome, ${params.name.trim()}!`);
    },
    [flashSaved]
  );

  const handleResetPassword = useCallback(
    async (identifier: string): Promise<string> => {
      setErrorMessage(null);
      const sentTo = await sendPasswordResetForIdentifier(identifier);
      flashSaved(`Password reset email sent to ${sentTo}`);
      return sentTo;
    },
    [flashSaved]
  );

  const handleSignIn = useCallback(async () => {
    setErrorMessage(null);
    await signInWithGoogle();
    flashSaved('Signed in with Google');
  }, [flashSaved]);

  const handleSignOut = useCallback(async () => {
    try {
      await signOutUser();
      flashSaved('Signed out (switched to local workspace)');
    } catch (err) {
      flashError(err instanceof Error ? err.message : 'Sign-out failed.');
    }
  }, [flashSaved, flashError]);

  return {
    user,
    authReady,
    isCloudMode,
    loading: loading || seedingCloud,
    seedingCloud,
    syncStatus,
    statusMessage,
    errorMessage,
    clearError: () => setErrorMessage(null),
    trees,
    activeTree,
    activeTreeId: effectiveActiveTreeId,
    activeTreeRole,
    isOwnerOfActiveTree,
    canEditActiveTree,
    members,
    relationships,
    displayMembers,
    displayRelationships,
    incomingInvites,
    ownedTreeCollaborators,
    ownedTreeInvites,
    incomingLinkRequests,
    outgoingLinkRequests,
    treeConnections,
    activeTreeConnections,
    combinedViewEnabled,
    setCombinedViewEnabled,
    combinedViewActive,
    connectedTreeCount: reachableConnectedTreeIds.length,
    getCollaboratorsForTree,
    getInvitesForTree,
    selectTree,
    createTree,
    renameTree,
    deleteTree,
    importTemplateTree,
    inviteFamilyMember,
    updateInviteRole,
    cancelInvite,
    acceptInvite,
    declineInvite,
    updateCollaboratorRole,
    revokeCollaborator,
    leaveSharedTree,
    fetchMembersForTree,
    sendTreeLinkRequest,
    acceptTreeLinkRequest,
    declineTreeLinkRequest,
    cancelTreeLinkRequest,
    updateConnectionPermission,
    disconnectTrees,
    addMember,
    updateMember,
    deleteMember,
    linkExistingMembers,
    deleteRelationship,
    login: handleLogin,
    register: handleRegister,
    resetPassword: handleResetPassword,
    signIn: handleSignIn,
    signOut: handleSignOut,
  };
}
