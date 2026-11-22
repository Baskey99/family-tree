import type {
  FamilyMember,
  FamilyRelationship,
  GenerationBand,
  LayoutConnector,
  LayoutNode,
  TreeLayoutResult,
} from '../types/family';

export const CARD_WIDTH = 224;
export const CARD_HEIGHT = 108;
const SPOUSE_GAP = 30;
const SIBLING_GAP = 36;
const BRANCH_GAP = 76;
const GEN_STEP_Y = 204; // CARD_HEIGHT (108) + 96px inter-generation routing channel
const CANVAS_PAD_X = 120;
const CANVAS_PAD_Y = 80;

interface FamilyUnit {
  id: string;
  memberIds: string[];
  generation: number;
  parentUnitId: string | null;
  childUnitIds: string[];
  ownWidth: number;
  subtreeWidth: number;
  x: number; // left edge of the unit's own cards
  y: number;
}

/**
 * Deterministic hierarchical genealogy layout engine:
 * - Vertical axis = Generations (Grandparents -> Parents -> Children -> Grandchildren)
 * - Horizontal axis = Same generation (Spouses adjacent, siblings grouped under shared parent bus,
 *   cousins in adjacent branches at identical generation Y)
 * - Zero overlapping cards guaranteed across arbitrarily large multi-root family trees.
 */
export function computeFamilyTreeLayout(
  members: FamilyMember[],
  relationships: FamilyRelationship[],
  collapsedMemberIds: Set<string>
): TreeLayoutResult {
  if (members.length === 0) {
    return {
      nodes: [],
      connectors: [],
      generations: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
      memberGenerationMap: new Map(),
    };
  }

  const memberMap = new Map<string, FamilyMember>(members.map((m) => [m.id, m]));
  const memberOrder = new Map<string, number>(members.map((m, idx) => [m.id, idx]));

  // Build adjacency lists
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  const spousesOf = new Map<string, string[]>();
  const sameGenLinks: [string, string][] = [];
  const grandparentCustomLinks: [string, string][] = [];

  for (const rel of relationships) {
    if (!memberMap.has(rel.personId) || !memberMap.has(rel.relatedPersonId)) continue;
    if (rel.personId === rel.relatedPersonId) continue;

    if (rel.relationshipType === 'parent_child') {
      const pList = parentsOf.get(rel.relatedPersonId) || [];
      if (!pList.includes(rel.personId)) pList.push(rel.personId);
      parentsOf.set(rel.relatedPersonId, pList);

      const cList = childrenOf.get(rel.personId) || [];
      if (!cList.includes(rel.relatedPersonId)) cList.push(rel.relatedPersonId);
      childrenOf.set(rel.personId, cList);
    } else if (rel.relationshipType === 'spouse') {
      const sA = spousesOf.get(rel.personId) || [];
      if (!sA.includes(rel.relatedPersonId)) sA.push(rel.relatedPersonId);
      spousesOf.set(rel.personId, sA);

      const sB = spousesOf.get(rel.relatedPersonId) || [];
      if (!sB.includes(rel.personId)) sB.push(rel.personId);
      spousesOf.set(rel.relatedPersonId, sB);
      sameGenLinks.push([rel.personId, rel.relatedPersonId]);
    } else if (rel.relationshipType === 'sibling' || rel.relationshipType === 'cousin') {
      sameGenLinks.push([rel.personId, rel.relatedPersonId]);
    } else if (
      rel.relationshipType === 'other' &&
      (rel.customLabel === 'Grandfather' || rel.customLabel === 'Grandmother')
    ) {
      grandparentCustomLinks.push([rel.personId, rel.relatedPersonId]);
    }
  }

  // --- Step 1: Compute Vertical Generations ---
  const gen = new Map<string, number>();
  for (const m of members) gen.set(m.id, 0);

  const maxPasses = Math.min(members.length + 10, 48);
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;

    for (const [childId, pList] of parentsOf.entries()) {
      let cGen = gen.get(childId) ?? 0;
      for (const pId of pList) {
        const pGen = gen.get(pId) ?? 0;
        if (cGen < pGen + 1) {
          cGen = pGen + 1;
          gen.set(childId, cGen);
          changed = true;
        }
      }
    }

    for (const [gpId, gcId] of grandparentCustomLinks) {
      const gpGen = gen.get(gpId) ?? 0;
      const gcGen = gen.get(gcId) ?? 0;
      if (gcGen < gpGen + 2) {
        gen.set(gcId, gpGen + 2);
        changed = true;
      }
    }

    for (const [a, b] of sameGenLinks) {
      const ga = gen.get(a) ?? 0;
      const gb = gen.get(b) ?? 0;
      if (ga !== gb) {
        const target = Math.max(ga, gb);
        gen.set(a, target);
        gen.set(b, target);
        changed = true;
      }
    }

    if (!changed) break;
  }

  // Pull down parent-less ancestors whose children were pushed deeper (e.g., married-in branches)
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    for (const m of members) {
      const hasParents = (parentsOf.get(m.id) || []).length > 0;
      const kids = childrenOf.get(m.id) || [];
      if (!hasParents && kids.length > 0) {
        const minChildGen = Math.min(...kids.map((k) => gen.get(k) ?? 0));
        const curGen = gen.get(m.id) ?? 0;
        if (curGen < minChildGen - 1) {
          // Ensure none of m's spouses have parents that prevent moving down
          const spouses = spousesOf.get(m.id) || [];
          const canShift = spouses.every((s) => (parentsOf.get(s) || []).length === 0);
          if (canShift) {
            const newGen = minChildGen - 1;
            gen.set(m.id, newGen);
            for (const s of spouses) gen.set(s, newGen);
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }

  // Normalize minimum generation to 0
  let minGen = Infinity;
  for (const g of gen.values()) {
    if (g < minGen) minGen = g;
  }
  if (!Number.isFinite(minGen)) minGen = 0;
  for (const [id, g] of gen.entries()) {
    gen.set(id, g - minGen);
  }

  // --- Step 2: Collapse / Expand Visibility Calculation ---
  // Determine direct children of a member OR their spouse (couple's children)
  const getCoupleChildren = (memberId: string): string[] => {
    const set = new Set<string>(childrenOf.get(memberId) || []);
    for (const sp of spousesOf.get(memberId) || []) {
      for (const c of childrenOf.get(sp) || []) set.add(c);
    }
    return [...set];
  };

  // Pre-compute descendant counts for each member (including children's spouses)
  const countDescendants = (rootId: string): number => {
    const visited = new Set<string>([rootId, ...(spousesOf.get(rootId) || [])]);
    const queue = getCoupleChildren(rootId);
    let count = 0;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      count++;
      for (const sp of spousesOf.get(cur) || []) {
        if (!visited.has(sp)) {
          visited.add(sp);
          count++;
        }
      }
      for (const child of getCoupleChildren(cur)) {
        if (!visited.has(child)) queue.push(child);
      }
    }
    return count;
  };

  // Identify hidden members from collapsed branches
  const hiddenMembers = new Set<string>();
  const effectiveCollapsed = new Set<string>(collapsedMemberIds);
  // Propagate collapse flag to spouse so a couple behaves as one collapsible branch
  for (const cid of collapsedMemberIds) {
    for (const sp of spousesOf.get(cid) || []) {
      effectiveCollapsed.add(sp);
    }
  }

  // BFS from all root members (members without visible parents) stopping at collapsed members
  const visibleMembers = new Set<string>();
  const roots = members.filter((m) => (parentsOf.get(m.id) || []).length === 0);
  const startSet = roots.length > 0 ? roots : members;
  const bfsQueue: string[] = [];

  for (const r of startSet) {
    if (!visibleMembers.has(r.id)) {
      visibleMembers.add(r.id);
      bfsQueue.push(r.id);
    }
  }

  while (bfsQueue.length > 0) {
    const cur = bfsQueue.shift()!;
    // Spouses of a visible member are always visible
    for (const sp of spousesOf.get(cur) || []) {
      if (!visibleMembers.has(sp)) {
        visibleMembers.add(sp);
        bfsQueue.push(sp);
      }
    }
    // Same-gen explicit links (sibling/cousin) of a visible member are visible
    for (const [a, b] of sameGenLinks) {
      if (a === cur && !visibleMembers.has(b)) {
        visibleMembers.add(b);
        bfsQueue.push(b);
      } else if (b === cur && !visibleMembers.has(a)) {
        visibleMembers.add(a);
        bfsQueue.push(a);
      }
    }
    // Descend to children ONLY if this member/couple is NOT collapsed
    if (!effectiveCollapsed.has(cur)) {
      for (const childId of childrenOf.get(cur) || []) {
        if (!visibleMembers.has(childId)) {
          visibleMembers.add(childId);
          bfsQueue.push(childId);
        }
      }
    }
  }

  // Any member still unreached because of disconnected components without roots (safety net)
  for (const m of members) {
    if (!visibleMembers.has(m.id)) {
      // Check if they are hidden due to a collapsed ancestor
      let ancestorCollapsed = false;
      const upVisited = new Set<string>();
      const upStack = [...(parentsOf.get(m.id) || [])];
      while (upStack.length > 0) {
        const p = upStack.pop()!;
        if (effectiveCollapsed.has(p)) {
          ancestorCollapsed = true;
          break;
        }
        if (upVisited.has(p)) continue;
        upVisited.add(p);
        for (const gp of parentsOf.get(p) || []) upStack.push(gp);
      }
      if (ancestorCollapsed) {
        hiddenMembers.add(m.id);
      } else {
        visibleMembers.add(m.id);
      }
    }
  }

  // --- Step 3: Build Family Units (grouping spouses horizontally) ---
  const visibleList = members
    .filter((m) => visibleMembers.has(m.id))
    .sort((a, b) => {
      const ga = gen.get(a.id) ?? 0;
      const gb = gen.get(b.id) ?? 0;
      if (ga !== gb) return ga - gb;
      return (memberOrder.get(a.id) ?? 0) - (memberOrder.get(b.id) ?? 0);
    });

  const memberToUnit = new Map<string, string>();
  const units = new Map<string, FamilyUnit>();

  for (const m of visibleList) {
    if (memberToUnit.has(m.id)) continue;

    const mGen = gen.get(m.id) ?? 0;
    // Collect connected spouse cluster on the same generation
    const cluster: string[] = [m.id];
    const seen = new Set<string>([m.id]);
    const q = [m.id];
    while (q.length > 0) {
      const cur = q.shift()!;
      for (const sp of spousesOf.get(cur) || []) {
        if (
          !seen.has(sp) &&
          visibleMembers.has(sp) &&
          !memberToUnit.has(sp) &&
          (gen.get(sp) ?? 0) === mGen
        ) {
          seen.add(sp);
          cluster.push(sp);
          q.push(sp);
        }
      }
    }

    // Order couple members cleanly: member with parents in tree first, or male-left / female-right
    cluster.sort((aId, bId) => {
      const aHasParents = (parentsOf.get(aId) || []).some((p) => visibleMembers.has(p));
      const bHasParents = (parentsOf.get(bId) || []).some((p) => visibleMembers.has(p));
      if (aHasParents !== bHasParents) return aHasParents ? -1 : 1;
      const ma = memberMap.get(aId)!;
      const mb = memberMap.get(bId)!;
      if (ma.gender !== mb.gender) return ma.gender === 'male' ? -1 : 1;
      return (memberOrder.get(aId) ?? 0) - (memberOrder.get(bId) ?? 0);
    });

    const unitId = `unit_${cluster[0]}`;
    const ownWidth = cluster.length * CARD_WIDTH + Math.max(0, cluster.length - 1) * SPOUSE_GAP;
    units.set(unitId, {
      id: unitId,
      memberIds: cluster,
      generation: mGen,
      parentUnitId: null,
      childUnitIds: [],
      ownWidth,
      subtreeWidth: ownWidth,
      x: 0,
      y: CANVAS_PAD_Y + mGen * GEN_STEP_Y,
    });

    for (const id of cluster) {
      memberToUnit.set(id, unitId);
    }
  }

  // --- Step 4: Link Child Units to Parent Units (Primary Hierarchy) ---
  for (const unit of units.values()) {
    // Pick the first member of this unit that has visible parents in an earlier generation
    let chosenParentUnitId: string | null = null;
    for (const mId of unit.memberIds) {
      const visParents = (parentsOf.get(mId) || []).filter(
        (pId) => visibleMembers.has(pId) && (gen.get(pId) ?? 0) < unit.generation
      );
      if (visParents.length > 0) {
        const pUnitId = memberToUnit.get(visParents[0]);
        if (pUnitId && pUnitId !== unit.id) {
          chosenParentUnitId = pUnitId;
          break;
        }
      }
    }
    if (chosenParentUnitId) {
      unit.parentUnitId = chosenParentUnitId;
      const pUnit = units.get(chosenParentUnitId)!;
      if (!pUnit.childUnitIds.includes(unit.id)) {
        pUnit.childUnitIds.push(unit.id);
      }
    }
  }

  // Sort children of each unit deterministically
  for (const unit of units.values()) {
    unit.childUnitIds.sort((aId, bId) => {
      const ua = units.get(aId)!;
      const ub = units.get(bId)!;
      return (memberOrder.get(ua.memberIds[0]) ?? 0) - (memberOrder.get(ub.memberIds[0]) ?? 0);
    });
  }

  // --- Step 5: Bottom-Up Subtree Width Calculation ---
  const measured = new Set<string>();
  const measureUnit = (unitId: string): number => {
    const unit = units.get(unitId)!;
    if (measured.has(unitId)) return unit.subtreeWidth;
    measured.add(unitId);

    if (unit.childUnitIds.length === 0) {
      unit.subtreeWidth = unit.ownWidth;
      return unit.subtreeWidth;
    }

    let totalChildrenWidth = 0;
    unit.childUnitIds.forEach((childUnitId, idx) => {
      const cw = measureUnit(childUnitId);
      const childUnit = units.get(childUnitId)!;
      const prevChildUnit = idx > 0 ? units.get(unit.childUnitIds[idx - 1])! : null;
      const gap =
        idx === 0
          ? 0
          : childUnit.childUnitIds.length > 0 || (prevChildUnit && prevChildUnit.childUnitIds.length > 0)
            ? BRANCH_GAP
            : SIBLING_GAP;
      totalChildrenWidth += gap + cw;
    });

    unit.subtreeWidth = Math.max(unit.ownWidth, totalChildrenWidth);
    return unit.subtreeWidth;
  };

  const rootUnits = [...units.values()].filter((u) => u.parentUnitId === null);
  for (const ru of rootUnits) measureUnit(ru.id);

  // Order root units: largest lineage trees first, then earliest generation, then original order
  rootUnits.sort((a, b) => {
    if (a.generation !== b.generation) return a.generation - b.generation;
    if (b.subtreeWidth !== a.subtreeWidth) return b.subtreeWidth - a.subtreeWidth;
    return (memberOrder.get(a.memberIds[0]) ?? 0) - (memberOrder.get(b.memberIds[0]) ?? 0);
  });

  // --- Step 6: Top-Down Centered X Placement ---
  const placed = new Set<string>();
  const placeUnit = (unitId: string, leftBoundary: number) => {
    if (placed.has(unitId)) return;
    placed.add(unitId);
    const unit = units.get(unitId)!;

    // Place this unit centered over its subtreeWidth
    unit.x = leftBoundary + (unit.subtreeWidth - unit.ownWidth) / 2;

    if (unit.childUnitIds.length > 0) {
      let totalChildrenWidth = 0;
      unit.childUnitIds.forEach((cid, idx) => {
        const cu = units.get(cid)!;
        const prev = idx > 0 ? units.get(unit.childUnitIds[idx - 1])! : null;
        const gap =
          idx === 0
            ? 0
            : cu.childUnitIds.length > 0 || (prev && prev.childUnitIds.length > 0)
              ? BRANCH_GAP
              : SIBLING_GAP;
        totalChildrenWidth += gap + cu.subtreeWidth;
      });

      let cursorX = leftBoundary + (unit.subtreeWidth - totalChildrenWidth) / 2;
      unit.childUnitIds.forEach((cid, idx) => {
        const cu = units.get(cid)!;
        if (idx > 0) {
          const prev = units.get(unit.childUnitIds[idx - 1])!;
          const gap =
            cu.childUnitIds.length > 0 || prev.childUnitIds.length > 0
              ? BRANCH_GAP
              : SIBLING_GAP;
          cursorX += gap;
        }
        placeUnit(cid, cursorX);
        cursorX += cu.subtreeWidth;
      });
    }
  };

  let rootCursorX = CANVAS_PAD_X;
  for (const ru of rootUnits) {
    placeUnit(ru.id, rootCursorX);
    rootCursorX += ru.subtreeWidth + BRANCH_GAP * 1.4;
  }

  // --- Step 7: Create Individual LayoutNodes & Enforce Zero-Overlap per Generation ---
  const nodeMap = new Map<string, LayoutNode>();
  for (const unit of units.values()) {
    unit.memberIds.forEach((mId, idx) => {
      const member = memberMap.get(mId)!;
      const coupleKids = getCoupleChildren(mId);
      const isCollapsed = effectiveCollapsed.has(mId) && coupleKids.length > 0;
      const hiddenCount = isCollapsed ? countDescendants(mId) : 0;

      nodeMap.set(mId, {
        member,
        x: unit.x + idx * (CARD_WIDTH + SPOUSE_GAP),
        y: unit.y,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        generation: unit.generation,
        hasChildren: coupleKids.length > 0,
        isCollapsed,
        hiddenDescendantCount: hiddenCount,
        unitId: unit.id,
      });
    });
  }

  // Per-generation sweep to mathematically guarantee zero overlaps even in complex multi-generation intermarriages
  const nodesByGen = new Map<number, LayoutNode[]>();
  for (const node of nodeMap.values()) {
    const arr = nodesByGen.get(node.generation) || [];
    arr.push(node);
    nodesByGen.set(node.generation, arr);
  }
  for (const row of nodesByGen.values()) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) {
      const prev = row[i - 1];
      const cur = row[i];
      const minGap = prev.unitId === cur.unitId ? SPOUSE_GAP : 28;
      const minAllowedX = prev.x + CARD_WIDTH + minGap;
      if (cur.x < minAllowedX) {
        cur.x = minAllowedX;
      }
    }
  }

  // --- Step 8: Orthogonal Connector Routing ---
  const connectors: LayoutConnector[] = [];

  // 8a. Spouse horizontal connectors
  const drawnSpousePairs = new Set<string>();
  for (const rel of relationships) {
    if (rel.relationshipType !== 'spouse') continue;
    const nA = nodeMap.get(rel.personId);
    const nB = nodeMap.get(rel.relatedPersonId);
    if (!nA || !nB) continue;
    const key = [nA.member.id, nB.member.id].sort().join(':');
    if (drawnSpousePairs.has(key)) continue;
    drawnSpousePairs.add(key);

    const [left, right] = nA.x <= nB.x ? [nA, nB] : [nB, nA];
    const startX = left.x + left.width;
    const endX = right.x;
    const midY = left.y + left.height / 2;

    if (Math.abs(left.y - right.y) < 10 && endX >= startX - 4) {
      const midX = (startX + endX) / 2;
      connectors.push({
        id: `conn_spouse_${rel.id}`,
        type: 'spouse',
        path: `M ${startX} ${midY} L ${endX} ${midY}`,
        unionPoint: { x: midX, y: midY },
        involvedMemberIds: [left.member.id, right.member.id],
      });
    } else {
      // Non-adjacent spouse fallback arc above the cards
      const leftCX = left.x + left.width / 2;
      const rightCX = right.x + right.width / 2;
      const arcY = Math.min(left.y, right.y) - 22;
      connectors.push({
        id: `conn_spouse_${rel.id}`,
        type: 'spouse',
        path: `M ${leftCX} ${left.y} L ${leftCX} ${arcY} L ${rightCX} ${arcY} L ${rightCX} ${right.y}`,
        unionPoint: { x: (leftCX + rightCX) / 2, y: arcY },
        involvedMemberIds: [left.member.id, right.member.id],
      });
    }
  }

  // 8b. Parent -> Child orthogonal grouped connectors
  // Group children by their visible parent set (deduplicating married couple parents into one union origin)
  interface ParentGroup {
    key: string;
    parentIds: string[];
    originX: number;
    originY: number;
    childNodes: LayoutNode[];
  }
  const parentGroups = new Map<string, ParentGroup>();

  for (const node of nodeMap.values()) {
    const visParents = (parentsOf.get(node.member.id) || []).filter((pId) => nodeMap.has(pId));
    if (visParents.length === 0) continue;

    // If a child has a single parent who is adjacent to a spouse, check if the child should descend from the couple union
    // only when both parents are linked, OR if one parent is linked and they are the sole parent in a couple.
    const sortedParents = [...visParents].sort();
    let originX: number;
    let originY: number;
    let groupKey: string;
    let groupParents = sortedParents;

    if (sortedParents.length >= 2) {
      const p1 = nodeMap.get(sortedParents[0])!;
      const p2 = nodeMap.get(sortedParents[1])!;
      if (p1.unitId === p2.unitId) {
        const [left, right] = p1.x <= p2.x ? [p1, p2] : [p2, p1];
        originX = (left.x + left.width + right.x) / 2;
        originY = left.y + left.height / 2;
        groupKey = `couple_${left.member.id}_${right.member.id}`;
      } else {
        // Two parents in different units: emit separate group per parent
        for (const pId of sortedParents) {
          const pNode = nodeMap.get(pId)!;
          const k = `single_${pId}`;
          const existing = parentGroups.get(k) || {
            key: k,
            parentIds: [pId],
            originX: pNode.x + pNode.width / 2,
            originY: pNode.y + pNode.height,
            childNodes: [],
          };
          existing.childNodes.push(node);
          parentGroups.set(k, existing);
        }
        continue;
      }
    } else {
      const pNode = nodeMap.get(sortedParents[0])!;
      const pUnit = units.get(pNode.unitId);
      // If this parent has a single spouse in the same unit and the spouse has no separate children of their own,
      // descend cleanly from the couple's union midpoint for a classic family tree look!
      if (pUnit && pUnit.memberIds.length === 2) {
        const [m1Id, m2Id] = pUnit.memberIds;
        const n1 = nodeMap.get(m1Id)!;
        const n2 = nodeMap.get(m2Id)!;
        const [left, right] = n1.x <= n2.x ? [n1, n2] : [n2, n1];
        originX = (left.x + left.width + right.x) / 2;
        originY = left.y + left.height / 2;
        groupKey = `couple_${left.member.id}_${right.member.id}`;
        groupParents = [left.member.id, right.member.id];
      } else {
        originX = pNode.x + pNode.width / 2;
        originY = pNode.y + pNode.height;
        groupKey = `single_${pNode.member.id}`;
        groupParents = [pNode.member.id];
      }
    }

    const existing = parentGroups.get(groupKey) || {
      key: groupKey,
      parentIds: groupParents,
      originX,
      originY,
      childNodes: [],
    };
    existing.childNodes.push(node);
    parentGroups.set(groupKey, existing);
  }

  // Track used horizontal bus ranges per channel to gently stagger overlapping bars
  const channelBars = new Map<number, { minX: number; maxX: number; slot: number }[]>();

  for (const group of parentGroups.values()) {
    const sortedKids = [...group.childNodes].sort((a, b) => a.x - b.x);
    const parentBottomY =
      Math.max(...group.parentIds.map((pid) => nodeMap.get(pid)!.y + CARD_HEIGHT));
    const minChildTopY = Math.min(...sortedKids.map((k) => k.y));
    const channelIndex = Math.round(parentBottomY / GEN_STEP_Y);

    const kidCenters = sortedKids.map((k) => k.x + k.width / 2);
    const spanMinX = Math.min(group.originX, ...kidCenters);
    const spanMaxX = Math.max(group.originX, ...kidCenters);

    const bars = channelBars.get(channelIndex) || [];
    let slot = 0;
    while (
      bars.some(
        (b) => b.slot === slot && !(spanMaxX + 12 < b.minX || spanMinX - 12 > b.maxX)
      )
    ) {
      slot++;
    }
    bars.push({ minX: spanMinX, maxX: spanMaxX, slot });
    channelBars.set(channelIndex, bars);

    const defaultBusY = parentBottomY + (minChildTopY - parentBottomY) * 0.5;
    const offset = ((slot % 5) - Math.min(slot, 2) * 0.5) * 10;
    const busY = Math.max(parentBottomY + 20, Math.min(minChildTopY - 20, defaultBusY + offset));

    // Build crisp orthogonal path: trunk -> horizontal sibling bar -> child drops
    const segments: string[] = [];
    segments.push(`M ${group.originX} ${group.originY} L ${group.originX} ${busY}`);

    const barMinX = Math.min(group.originX, ...kidCenters);
    const barMaxX = Math.max(group.originX, ...kidCenters);
    if (barMaxX - barMinX > 0.5) {
      segments.push(`M ${barMinX} ${busY} L ${barMaxX} ${busY}`);
    }

    for (const kid of sortedKids) {
      const cx = kid.x + kid.width / 2;
      segments.push(`M ${cx} ${busY} L ${cx} ${kid.y}`);
    }

    connectors.push({
      id: `conn_pc_${group.key}`,
      type: 'parent_child',
      path: segments.join(' '),
      involvedMemberIds: [...group.parentIds, ...sortedKids.map((k) => k.member.id)],
    });
  }

  // 8c. Explicit non-parent connectors (sibling without shared parent, cousin, other)
  for (const rel of relationships) {
    if (
      rel.relationshipType !== 'sibling' &&
      rel.relationshipType !== 'cousin' &&
      rel.relationshipType !== 'other'
    ) {
      continue;
    }
    const nA = nodeMap.get(rel.personId);
    const nB = nodeMap.get(rel.relatedPersonId);
    if (!nA || !nB) continue;

    const aCX = nA.x + nA.width / 2;
    const bCX = nB.x + nB.width / 2;
    const topY = Math.min(nA.y, nB.y) - 24;
    const path = `M ${aCX} ${nA.y} L ${aCX} ${topY} L ${bCX} ${topY} L ${bCX} ${nB.y}`;
    const label =
      rel.relationshipType === 'sibling'
        ? 'Sibling'
        : rel.relationshipType === 'cousin'
          ? 'Cousin'
          : rel.customLabel || 'Relative';

    connectors.push({
      id: `conn_rel_${rel.id}`,
      type: rel.relationshipType,
      path,
      label,
      labelPos: { x: (aCX + bCX) / 2, y: topY - 6 },
      involvedMemberIds: [nA.member.id, nB.member.id],
    });
  }

  // --- Step 9: Compute Bounds & Generation Bands ---
  const nodes = [...nodeMap.values()];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (n.y + n.height > maxY) maxY = n.y + n.height;
  }

  const genEntries = [...nodesByGen.entries()].sort((a, b) => a[0] - b[0]);
  const generations: GenerationBand[] = genEntries.map(([gIdx, list]) => ({
    generation: gIdx,
    label: `Gen ${gIdx + 1}`,
    y: CANVAS_PAD_Y + gIdx * GEN_STEP_Y,
    count: list.length,
  }));

  return {
    nodes,
    connectors,
    generations,
    bounds: {
      minX: Number.isFinite(minX) ? minX - CANVAS_PAD_X : 0,
      minY: Number.isFinite(minY) ? minY - CANVAS_PAD_Y : 0,
      maxX: Number.isFinite(maxX) ? maxX + CANVAS_PAD_X : 0,
      maxY: Number.isFinite(maxY) ? maxY + CANVAS_PAD_Y : 0,
      width: Number.isFinite(maxX - minX) ? maxX - minX + CANVAS_PAD_X * 2 : 0,
      height: Number.isFinite(maxY - minY) ? maxY - minY + CANVAS_PAD_Y * 2 : 0,
    },
    memberGenerationMap: gen,
  };
}
