# Security Specification & Payload-First TDD — Kinship Family Tree

## 1. Data Invariants

1. **Strict Ownership & PII Isolation**: Every `FamilyTree`, `FamilyMember`, and `FamilyRelationship` document belongs to a single authenticated owner (`ownerId == request.auth.uid`). Personal information (`address`, `dateOfBirth`, `notes`, `photoUrl`) is never readable by any other authenticated or unauthenticated user.
2. **Master Gate Relational Sync**: Subcollection reads (`get`) and writes (`create`, `update`, `delete`) on `/family_trees/{treeId}/members/{memberId}` and `/family_trees/{treeId}/relationships/{relationshipId}` verify parent tree existence and ownership via `get(/databases/$(database)/documents/family_trees/$(treeId)).data.ownerId == request.auth.uid`.
3. **O(1) Secure List Queries**: `allow list` on `family_trees`, `members`, and `relationships` evaluates `resource.data.ownerId == request.auth.uid` directly without `get()` lookups.
4. **Strict Key & Size Enforcement**: Every write validates required + allowed keys (`hasAll` + `hasOnly`), string length bounds, ID regex (`^[a-zA-Z0-9_\-]+$`), enum values, and immutable fields (`ownerId`, `treeId`, `createdAt`).
5. **Temporal Integrity**: `createdAt == request.time` on create and `updatedAt == request.time` on create/update; client-forged timestamps are rejected.
6. **Verified Accounts Only**: All write operations require `request.auth.token.email_verified == true`.
7. **Self-Loop Prevention**: `FamilyRelationship` forbids `personId == relatedPersonId`.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Identity Spoofing on Tree Create**: `{ ownerId: "victim_uid", name: "Fake", description: "", createdAt: now, updatedAt: now }` -> `PERMISSION_DENIED`.
2. **Shadow Field Injection on Member Create**: Valid member payload + `{ isAdmin: true }` -> `PERMISSION_DENIED`.
3. **Cross-Owner PII Read**: Authenticated user B calls `get(/family_trees/treeA/members/m1)` -> `PERMISSION_DENIED`.
4. **Blanket List Scraping**: Authenticated user B queries `collection('family_trees')` without `where('ownerId', '==', uidB)` -> `PERMISSION_DENIED`.
5. **ID Poisoning**: Creating `/family_trees/treeA/members/<1500-char-id>` -> `PERMISSION_DENIED`.
6. **Resource Exhaustion (1MB Notes)**: Member with `notes: "A".repeat(2000)` -> `PERMISSION_DENIED`.
7. **Unverified Email Write**: Authenticated user with `email_verified: false` creating a tree -> `PERMISSION_DENIED`.
8. **Forged Timestamp**: Member create with client-supplied `createdAt: Timestamp.fromMillis(0)` -> `PERMISSION_DENIED`.
9. **Immutable Field Tampering**: Updating a member's `ownerId` or `treeId` or `createdAt` -> `PERMISSION_DENIED`.
10. **Value Poisoning on Update**: Updating `gender` to `"invalid_gender"` or `manualAge` to `999` -> `PERMISSION_DENIED`.
11. **Orphaned Subcollection Write**: Creating a member under a non-existent `treeId` -> `PERMISSION_DENIED`.
12. **Self-Referencing Relationship**: Creating a relationship where `personId === relatedPersonId` -> `PERMISSION_DENIED`.
