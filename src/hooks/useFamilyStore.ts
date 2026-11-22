import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
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
  OperationType,
  signInWithGoogle,
  signOutUser,
} from '../lib/firebase';
import {
  generateSafeId,
  hasExistingRelationship,
  planRelationshipsForNewMember,
  wouldCreateParentCycle,
} from '../lib/familyUtils';
import type {
  FamilyMember,
  FamilyRelationship,
  FamilyTreeRecord,
  FormRelationshipType,
  Gender,
  SeedTreeTemplate,
  StoredRelationshipType,
} from '../types/family';

const LOCAL_STORAGE_KEY = 'kinship_family_tree_workspace_v1';

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
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof val === 'string') return val;
  return new Date().toISOString();
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
      name: seed.name,
      description: seed.description,
      createdAt: now,
      updatedAt: now,
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
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalWorkspaceData;
      if (Array.isArray(parsed.trees)) {
        return parsed;
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
  const [cloudTrees, setCloudTrees] = useState<FamilyTreeRecord[]>([]);
  const [cloudMembers, setCloudMembers] = useState<FamilyMember[]>([]);
  const [cloudRelationships, setCloudRelationships] = useState<FamilyRelationship[]>([]);

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
    }, 3200);
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
          name: template.name.slice(0, 120),
          description: template.description.slice(0, 400),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, treePath);
      }

      // Batch write members + relationships in chunks of 350 ops (Firestore limit is 500)
      const ops: Array<() => void> = [];
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
      void ops;
      return treeId;
    },
    []
  );

  // Subscribe to user's family_trees in Firestore when signed in
  useEffect(() => {
    if (!authReady || !user) {
      setCloudTrees([]);
      setCloudMembers([]);
      setCloudRelationships([]);
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
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              ownerId: String(data.ownerId || ''),
              name: String(data.name || 'Untitled Tree'),
              description: String(data.description || ''),
              createdAt: formatFirestoreTimestamp(data.createdAt),
              updatedAt: formatFirestoreTimestamp(data.updatedAt),
            };
          })
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

        setCloudTrees(list);

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
            flashSaved('Imported attached family trees to Cloud Firestore');
          } catch (err) {
            flashError(err instanceof Error ? err.message : 'Failed to initialize cloud trees.');
          } finally {
            setSeedingCloud(false);
            setLoading(false);
          }
          return;
        }

        setActiveTreeId((prev) => {
          if (list.some((t) => t.id === prev)) return prev;
          return list[0]?.id || '';
        });
        setLoading(false);
      },
      (error) => {
        setLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'family_trees');
      }
    );

    return () => unsub();
  }, [authReady, user, importSeedTreeToCloud, flashSaved, flashError]);

  // Subscribe to active tree's members and relationships in Firestore
  useEffect(() => {
    if (!authReady || !user || !activeTreeId) {
      setCloudMembers([]);
      setCloudRelationships([]);
      return;
    }
    if (!cloudTrees.some((t) => t.id === activeTreeId)) {
      return;
    }

    const membersPath = `family_trees/${activeTreeId}/members`;
    const relsPath = `family_trees/${activeTreeId}/relationships`;

    const membersQuery = query(
      collection(db, 'family_trees', activeTreeId, 'members'),
      where('ownerId', '==', user.uid)
    );
    const relsQuery = query(
      collection(db, 'family_trees', activeTreeId, 'relationships'),
      where('ownerId', '==', user.uid)
    );

    const unsubMembers = onSnapshot(
      membersQuery,
      (snap) => {
        const list: FamilyMember[] = snap.docs
          .map((d): FamilyMember => {
            const data = d.data();
            return {
              id: d.id,
              treeId: String(data.treeId || activeTreeId),
              ownerId: String(data.ownerId || user.uid),
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
      relsQuery,
      (snap) => {
        const list: FamilyRelationship[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            treeId: String(data.treeId || activeTreeId),
            ownerId: String(data.ownerId || user.uid),
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
  }, [authReady, user, activeTreeId, cloudTrees]);

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
          name: cleanName,
          description: cleanDesc,
          createdAt: now,
          updatedAt: now,
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
              t.id === treeId ? { ...t, name: cleanName, description: cleanDesc, updatedAt: now } : t
            ),
          };
          saveLocalWorkspace(next);
          return next;
        });
        flashSaved('Updated family tree details');
      }
    },
    [user, flashSaved, flashError]
  );

  const deleteTree = useCallback(
    async (treeId: string): Promise<void> => {
      setSyncStatus('saving');
      if (user) {
        try {
          // Delete subcollection documents first in batches, then tree document
          const membersSnap = await getDocs(
            query(collection(db, 'family_trees', treeId, 'members'), where('ownerId', '==', user.uid))
          );
          const relsSnap = await getDocs(
            query(collection(db, 'family_trees', treeId, 'relationships'), where('ownerId', '==', user.uid))
          );
          const allRefs = [...membersSnap.docs.map((d) => d.ref), ...relsSnap.docs.map((d) => d.ref)];
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
    [user, flashSaved, flashError]
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
          name: template.name,
          description: template.description,
          createdAt: now,
          updatedAt: now,
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

  // --- CRUD: Members ---
  const addMember = useCallback(
    async (payload: MemberInputPayload): Promise<string> => {
      let targetTreeId = effectiveActiveTreeId;
      if (!targetTreeId) {
        targetTreeId = await createTree('My Family Tree', 'Personal family lineage.');
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

      setSyncStatus('saving');

      if (user) {
        try {
          const batch = writeBatch(db);
          const mRef = doc(db, 'family_trees', targetTreeId, 'members', newMemberId);
          batch.set(mRef, {
            treeId: targetTreeId,
            ownerId: user.uid,
            fullName,
            gender: payload.gender,
            dateOfBirth: normalizedDob,
            manualAge: normalizedManualAge,
            address: payload.address.trim().slice(0, 250),
            photoUrl: payload.photoUrl.slice(0, 65000),
            notes: payload.notes.trim().slice(0, 1000),
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
              ownerId: user.uid,
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
          fullName,
          gender: payload.gender,
          dateOfBirth: normalizedDob,
          manualAge: normalizedManualAge,
          address: payload.address.trim().slice(0, 250),
          photoUrl: payload.photoUrl.slice(0, 65000),
          notes: payload.notes.trim().slice(0, 1000),
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
    [effectiveActiveTreeId, createTree, relationships, user, flashSaved, flashError]
  );

  const updateMember = useCallback(
    async (
      memberId: string,
      updates: Omit<MemberInputPayload, 'relationship'>
    ): Promise<void> => {
      if (!effectiveActiveTreeId) return;
      const fullName = updates.fullName.trim().slice(0, 140);
      if (!fullName) throw new Error('Full Name is required.');

      const normalizedDob = updates.dateOfBirth.trim().slice(0, 32);
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
            address: updates.address.trim().slice(0, 250),
            photoUrl: updates.photoUrl.slice(0, 65000),
            notes: updates.notes.trim().slice(0, 1000),
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
                      address: updates.address.trim().slice(0, 250),
                      photoUrl: updates.photoUrl.slice(0, 65000),
                      notes: updates.notes.trim().slice(0, 1000),
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
    [effectiveActiveTreeId, user, flashSaved, flashError]
  );

  const deleteMember = useCallback(
    async (memberId: string): Promise<void> => {
      if (!effectiveActiveTreeId) return;
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
          flashSaved(`Removed ${target?.fullName || 'member'} and ${attachedRels.length} connection(s)`);
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
    [effectiveActiveTreeId, members, relationships, user, flashSaved, flashError]
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
      setSyncStatus('saving');

      if (user) {
        const path = `family_trees/${effectiveActiveTreeId}/relationships/${relId}`;
        try {
          await setDoc(doc(db, 'family_trees', effectiveActiveTreeId, 'relationships', relId), {
            treeId: effectiveActiveTreeId,
            ownerId: user.uid,
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
    [effectiveActiveTreeId, relationships, user, flashSaved, flashError]
  );

  const deleteRelationship = useCallback(
    async (relationshipId: string): Promise<void> => {
      if (!effectiveActiveTreeId) return;
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
    [effectiveActiveTreeId, user, flashSaved, flashError]
  );

  const handleSignIn = useCallback(async () => {
    try {
      setErrorMessage(null);
      await signInWithGoogle();
    } catch (err) {
      flashError(
        err instanceof Error ? err.message : 'Google Sign-In was cancelled or failed.'
      );
    }
  }, [flashError]);

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
    members,
    relationships,
    selectTree,
    createTree,
    renameTree,
    deleteTree,
    importTemplateTree,
    addMember,
    updateMember,
    deleteMember,
    linkExistingMembers,
    deleteRelationship,
    signIn: handleSignIn,
    signOut: handleSignOut,
  };
}
