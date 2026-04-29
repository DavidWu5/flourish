const SVG_NS = "http://www.w3.org/2000/svg";

const WIDTH = 1000;
const HEIGHT = 720;
const ROOT_X = WIDTH / 2;
const ROOT_Y = HEIGHT - 92;
const GROW_DURATION = 1250;
const EMPHASIS_FADE_DURATION = 180;
const BRANCH_RENDER_SCALE = 0.9;
const BRANCH_GRADIENT_LAYERS = 12;
const DIMMED_TREE_OPACITY = 0.18;
const BRANCH_EDGE_RGB = { r: 96, g: 58, b: 38 };
const BRANCH_CENTER_RGB = { r: 171, g: 124, b: 90 };
const BRANCH_HIGHLIGHT_RGB = { r: 225, g: 192, b: 150 };

export function createTreeRenderer({
  svg,
  branchBackdrop,
  branchGroup,
  tipGroup,
  nodeGroup,
}) {
  const defs = createSvgElement("defs");
  svg.insertBefore(defs, svg.firstChild);

  const state = {
    nodes: new Map(),
    rootId: null,
    animation: null,
    emphasisAnimation: null,
    rafId: 0,
    lastNow: performance.now(),
    hoverPathNodeId: null,
    hoveredNodeId: null,
    onExpandRequest: () => {},
  };

  svg.addEventListener("mouseleave", () => {
    clearHoverState(null, null, true);
  });
  svg.addEventListener("pointermove", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest(".branch-hit") ||
      target.closest(".topic-hit") ||
      target.closest(".tip-button")
    ) {
      return;
    }
    clearHoverState(null, null, true);
  });

  function randomSeeds() {
    return {
      curve: Math.random(),
      warp: Math.random(),
      lean: Math.random() * 2 - 1,
      length: Math.random(),
    };
  }

  function defaultPose() {
    return {
      x: ROOT_X,
      y: ROOT_Y,
      angle: -Math.PI / 2,
      thickness: 16,
    };
  }

  function baseStats() {
    return {
      weight: 1,
      spread: 0,
      girth: 1.4,
      crown: 1,
    };
  }

  function createVisualNode(data) {
    const pose = defaultPose();
    return {
      id: data.id,
      label: data.label || data.id,
      summary: data.summary || "",
      metadata: data.metadata || {},
      parentId: data.parentId ?? null,
      children: [],
      depth: 0,
      slot: data.parentId ? "branch" : "root",
      side: 0,
      expandable: data.expandable !== false,
      seed: randomSeeds(),
      stats: baseStats(),
      target: { ...pose },
      from: { ...pose },
      render: {
        ...pose,
        visibility: data.parentId ? 0 : 1,
        emphasis: 1,
      },
      ui: {
        loading: false,
        error: null,
      },
    };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function easeOutSine(t) {
    return Math.sin((t * Math.PI) / 2);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpColor(a, b, t) {
    return {
      r: Math.round(lerp(a.r, b.r, t)),
      g: Math.round(lerp(a.g, b.g, t)),
      b: Math.round(lerp(a.b, b.b, t)),
    };
  }

  function rgbToCss(color) {
    return `rgb(${color.r}, ${color.g}, ${color.b})`;
  }

  function lerpAngle(a, b, t) {
    const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return a + delta * t;
  }

  function pointAtAngle(origin, angle, length) {
    return {
      x: origin.x + Math.cos(angle) * length,
      y: origin.y + Math.sin(angle) * length,
    };
  }

  function perpendicular(vector) {
    return { x: -vector.y, y: vector.x };
  }

  function normalize(vector) {
    const length = Math.hypot(vector.x, vector.y) || 1;
    return {
      x: vector.x / length,
      y: vector.y / length,
    };
  }

  function childSpreadOffset(index, count) {
    if (count <= 1) return 0;
    return lerp(-1, 1, index / (count - 1));
  }

  function childFanSpread(node, count) {
    const density = clamp((count - 1) / 4, 0, 1);
    const depthT = clamp(node.depth / 7, 0, 1);
    return lerp(0.34, 0.96, density) * lerp(1.08, 0.74, depthT);
  }

  function centerAffinityAt(x) {
    return 1 - clamp(Math.abs(x - ROOT_X) / 340, 0, 1);
  }

  function spreadMultiplier(parent, child, siblingCount) {
    const centerPressure = centerAffinityAt(parent.target.x);
    const crowdPressure = clamp((siblingCount - 1) / 4, 0, 1);
    const crownPressure = clamp((child.stats.crown - 1) / 8, 0, 1);
    const parentPressure = clamp((parent.stats.crown - 1) / 10, 0, 1);
    const trunkBoost = child.slot === "trunk" ? 0.16 : 0;

    return (
      1 +
      trunkBoost +
      centerPressure * (0.16 + crownPressure * 0.24 + parentPressure * 0.14) +
      crowdPressure * 0.08
    );
  }

  function childLayoutOffsets(node) {
    const children = node.children.map((childId) => state.nodes.get(childId));
    if (children.length <= 1) return [0];

    const weights = children.map((child) =>
      Math.max(1, child.stats.crown * 0.82 + child.stats.girth * 0.34),
    );
    const gap = 0.74 + clamp(node.depth / 8, 0, 1) * 0.12;
    const total = weights.reduce((sum, weight) => sum + weight, 0) + gap * (weights.length - 1);

    let cursor = -total / 2;
    const centers = weights.map((weight) => {
      const center = cursor + weight / 2;
      cursor += weight + gap;
      return center;
    });
    const maxAbs = Math.max(...centers.map((value) => Math.abs(value))) || 1;

    return centers.map((value) => clamp(value / maxAbs, -1, 1));
  }

  function canExpand(node) {
    return Boolean(node.expandable) && !node.ui.loading && node.children.length === 0;
  }

  function createSvgElement(name, attrs = {}) {
    const element = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) {
      element.setAttribute(key, String(value));
    }
    return element;
  }

  function patchPublicNode(node, patch) {
    if (!node) return;
    if (Object.hasOwn(patch, "label")) node.label = patch.label;
    if (Object.hasOwn(patch, "summary")) node.summary = patch.summary || "";
    if (Object.hasOwn(patch, "metadata")) node.metadata = patch.metadata || {};
    if (Object.hasOwn(patch, "expandable")) node.expandable = patch.expandable !== false;
  }

  function buildNodePathIds(nodeId) {
    const pathIds = new Set();
    let current = state.nodes.get(nodeId);

    while (current) {
      pathIds.add(current.id);
      current = current.parentId ? state.nodes.get(current.parentId) : null;
    }

    return pathIds;
  }

  function startEmphasisTransition(pathNodeId) {
    const targetPathIds =
      pathNodeId && state.nodes.has(pathNodeId) ? buildNodePathIds(pathNodeId) : null;
    const now = performance.now();
    let hasChange = false;

    for (const node of state.nodes.values()) {
      const nextEmphasis = targetPathIds?.has(node.id) ? 1 : targetPathIds ? DIMMED_TREE_OPACITY : 1;
      const currentEmphasis = node.render.emphasis ?? 1;
      node.fromEmphasis = currentEmphasis;
      node.targetEmphasis = nextEmphasis;
      if (Math.abs(currentEmphasis - nextEmphasis) > 0.001) {
        hasChange = true;
      }
    }

    if (!hasChange) {
      state.emphasisAnimation = null;
      return false;
    }

    state.emphasisAnimation = {
      start: now,
      end: now + EMPHASIS_FADE_DURATION,
    };
    return true;
  }

  function setHoverState(pathNodeId = null, hoveredNodeId = null) {
    if (state.hoverPathNodeId === pathNodeId && state.hoveredNodeId === hoveredNodeId) return;

    state.hoverPathNodeId = pathNodeId;
    state.hoveredNodeId = hoveredNodeId;
    const didStartTransition = startEmphasisTransition(pathNodeId);

    if (didStartTransition) {
      runAnimationLoop();
      return;
    }

    if (!state.animation) drawScene(state.lastNow);
  }

  function clearHoverState(pathNodeId = null, hoveredNodeId = null, force = false) {
    if (
      !force &&
      (state.hoverPathNodeId !== pathNodeId || state.hoveredNodeId !== hoveredNodeId)
    ) {
      return;
    }
    setHoverState(null, null);
  }

  function hydrateHierarchy(nodeId, parent = null) {
    const node = state.nodes.get(nodeId);
    if (!node) return;

    node.parentId = parent ? parent.id : null;
    node.depth = parent ? parent.depth + 1 : 0;
    node.slot = !parent ? "root" : !parent.parentId ? "trunk" : "branch";

    node.children.forEach((childId) => {
      hydrateHierarchy(childId, node);
    });
  }

  function setTree(snapshot) {
    cancelAnimationFrame(state.rafId);
    state.nodes.clear();
    state.animation = null;
    state.emphasisAnimation = null;
    state.hoverPathNodeId = null;
    state.hoveredNodeId = null;

    if (!snapshot?.root) {
      throw new Error("Tree snapshot must include a root node");
    }

    const flatNodes = [snapshot.root, ...(snapshot.nodes || [])];
    flatNodes.forEach((data) => {
      state.nodes.set(data.id, createVisualNode(data));
    });

    flatNodes.forEach((data) => {
      if (!data.parentId) return;
      const parent = state.nodes.get(data.parentId);
      const child = state.nodes.get(data.id);
      if (!parent || !child) return;
      parent.children.push(child.id);
      child.parentId = parent.id;
    });

    state.rootId = snapshot.root.id;
    hydrateHierarchy(state.rootId);
    layoutTree();

    for (const node of state.nodes.values()) {
      node.from = { ...node.target };
      node.render = { ...node.target, visibility: 1, emphasis: 1 };
      node.fromEmphasis = 1;
      node.targetEmphasis = 1;
    }

    drawScene(performance.now());
  }

  function appendChildren(parentId, childNodes) {
    const parent = state.nodes.get(parentId);
    if (!parent || !childNodes.length) {
      if (!state.animation) drawScene(state.lastNow);
      return;
    }

    const freshNodes = [];
    const now = performance.now();
    const existingLabels = new Set(
      parent.children
        .map((childId) => state.nodes.get(childId)?.label?.trim().toLowerCase())
        .filter(Boolean),
    );

    for (const node of state.nodes.values()) {
      node.from = {
        x: node.render.x,
        y: node.render.y,
        angle: node.render.angle,
        thickness: node.render.thickness,
      };
    }

    for (const data of childNodes) {
      const labelKey = data.label?.trim().toLowerCase();
      if (state.nodes.has(data.id) || (labelKey && existingLabels.has(labelKey))) continue;
      const child = createVisualNode({ ...data, parentId });
      state.nodes.set(child.id, child);
      parent.children.push(child.id);
      if (labelKey) existingLabels.add(labelKey);

      child.from = {
        x: parent.render.x,
        y: parent.render.y,
        angle: parent.render.angle,
        thickness: Math.max(1.4, parent.render.thickness * 0.74),
      };
      child.render = {
        ...child.from,
        visibility: 0.0001,
        emphasis: child.targetEmphasis ?? parent.render.emphasis ?? 1,
      };
      freshNodes.push(child.id);
    }

    if (!freshNodes.length) {
      drawScene(now);
      return;
    }

    hydrateHierarchy(state.rootId);
    layoutTree();

    state.animation = {
      newChildIds: new Set(freshNodes),
      sourceId: parentId,
      start: now,
      end: now + GROW_DURATION,
    };

    runAnimationLoop();
  }

  function setExpandHandler(handler) {
    state.onExpandRequest = handler;
  }

  function setNodeLoading(nodeId, loading) {
    const node = state.nodes.get(nodeId);
    if (!node) return;
    node.ui.loading = loading;
    if (!state.animation) drawScene(state.lastNow);
  }

  function setNodeError(nodeId, error) {
    const node = state.nodes.get(nodeId);
    if (!node) return;
    node.ui.error = error;
    if (!state.animation) drawScene(state.lastNow);
  }

  function patchNode(nodeId, patch) {
    const node = state.nodes.get(nodeId);
    if (!node) return;
    patchPublicNode(node, patch);
    if (!state.animation) drawScene(state.lastNow);
  }

  function collectStats(nodeId) {
    const node = state.nodes.get(nodeId);
    if (!node.children.length) {
      node.stats = { weight: 1, spread: 0, girth: node.stats.girth, crown: 1 };
      return node.stats;
    }

    const childStats = node.children.map((childId) => collectStats(childId));
    const weight = childStats.reduce((sum, item) => sum + item.weight, 0);
    const spread = childStats.reduce((sum, item, index) => {
      const child = state.nodes.get(node.children[index]);
      return sum + item.weight * (child.side || 0);
    }, 0);
    const crown =
      childStats.reduce((sum, item) => sum + item.crown, 0) +
      Math.max(0, node.children.length - 1) * 0.65;

    node.stats = { weight, spread, girth: node.stats.girth, crown };
    return node.stats;
  }

  function branchLength(node) {
    if (node.slot === "trunk") return 118;

    const siblingCount = node.parentId ? state.nodes.get(node.parentId).children.length : 1;
    const depthScale = Math.pow(0.81, Math.max(0, node.depth - 2));
    const vigor = 0.95 + Math.min(0.24, node.stats.weight * 0.06);
    const noise = 0.9 + node.seed.length * 0.18;
    const crowdScale = lerp(1.04, 0.84, clamp((siblingCount - 1) / 4, 0, 1));
    const centerCrowding = (1 - Math.abs(node.side)) * clamp((node.stats.crown - 1) / 9, 0, 1);
    const centerlineBoost = 0.97 + Math.abs(node.side) * 0.06 - centerCrowding * 0.12;
    const crownReach = lerp(0.98, 1.2, clamp(node.stats.crown / 10, 0, 1));
    const girthReach = lerp(0.96, 1.14, clamp(node.stats.girth / 18, 0, 1));
    return 100 * depthScale * vigor * noise * crowdScale * centerlineBoost * crownReach * girthReach;
  }

  function thicknessFloor(node) {
    if (!node.parentId) return 22;

    const depthBase = 12.8 * Math.pow(0.77, node.depth - 1);
    const vigor = 1 + Math.min(0.28, Math.sqrt(node.stats.weight) * 0.07);
    return Math.max(1.35, depthBase * vigor);
  }

  function branchThickness(nodeId) {
    const node = state.nodes.get(nodeId);
    const childGirth = node.children.map(branchThickness);
    const structuralFloor = thicknessFloor(node);

    if (!childGirth.length) {
      node.stats.girth = structuralFloor;
      return node.stats.girth;
    }

    const combinedFlow =
      Math.pow(
        childGirth.reduce((sum, girth) => sum + Math.pow(girth, 1.85), 0),
        1 / 1.85,
      ) * (node.parentId ? 1.03 : 1.08);

    if (!node.parentId) {
      node.stats.girth = Math.max(structuralFloor, combinedFlow);
      return node.stats.girth;
    }

    const parent = state.nodes.get(node.parentId);
    const siblingCount = parent ? parent.children.length : 1;
    const crowdPenalty = lerp(1, 0.7, clamp((siblingCount - 1) / 4, 0, 1));
    const depthCap = 13.6 * Math.pow(0.83, Math.max(0, node.depth - 1));
    const crownAllowance = 3.8 + Math.sqrt(node.stats.crown) * 2.3;
    const girthCap = Math.max(structuralFloor, (depthCap + crownAllowance) * crowdPenalty);

    node.stats.girth = clamp(Math.max(structuralFloor, combinedFlow), structuralFloor, girthCap);
    return node.stats.girth;
  }

  function branchStartWidth(parent, child) {
    const parentCarry =
      child.slot === "trunk" ? parent.render.thickness * 1.02 : parent.render.thickness;
    const childContinuity = child.render.thickness * 1.08;
    return Math.max(child.render.thickness, parentCarry, childContinuity);
  }

  function branchEndWidth(child) {
    const continuity = child.children.length ? 1.04 : 0.84;
    return Math.max(1.05, child.render.thickness * continuity);
  }

  function nextAngleFor(parent, node, offset, siblingCount) {
    if (node.slot === "trunk") {
      const spread = lerp(0.22, 0.64, clamp((siblingCount - 1) / 4, 0, 1));
      const dynamicSpread =
        spread * (1 + centerAffinityAt(ROOT_X) * 0.12 + clamp((node.stats.crown - 1) / 8, 0, 1) * 0.18);
      return -Math.PI / 2 + offset * dynamicSpread + node.seed.lean * 0.05;
    }

    const outwardBias = clamp((parent.target.x - ROOT_X) / 330, -1, 1) * 0.12;
    const upBias = clamp(parent.depth / 6, 0, 1);
    const fan = childFanSpread(node, siblingCount) * spreadMultiplier(parent, node, siblingCount);
    const weightTuck = clamp(node.stats.weight / 20, 0, 0.12);
    const selfBalance =
      clamp(node.stats.spread / Math.max(node.stats.weight, 1), -1, 1) * 0.07;
    const angle =
      parent.target.angle +
      offset * (fan - weightTuck) +
      node.seed.lean * 0.08 +
      outwardBias * (0.3 + Math.abs(offset) * 0.28) -
      selfBalance;

    return clamp(angle, -2.62, -0.18 + upBias * 0.05);
  }

  function assignChildSides(nodeId) {
    const node = state.nodes.get(nodeId);
    const count = node.children.length;

    node.children.forEach((childId, index) => {
      const child = state.nodes.get(childId);
      child.side = childSpreadOffset(index, count);
      assignChildSides(child.id);
    });
  }

  function layoutNode(nodeId) {
    const node = state.nodes.get(nodeId);

    if (!node.parentId) {
      node.target = {
        x: ROOT_X,
        y: ROOT_Y,
        angle: -Math.PI / 2,
        thickness: node.stats.girth,
      };
    }

    if (!node.children.length) return;

    const children = node.children.map((childId) => state.nodes.get(childId));
    const siblingCount = children.length;
    const offsets = childLayoutOffsets(node);
    const rootCenterMass = !node.parentId
      ? children.reduce(
          (sum, child, index) => sum + child.stats.crown * (1 - Math.abs(offsets[index] || 0)),
          0,
        )
      : 0;
    const rootLateralPush = !node.parentId
      ? lerp(0, 72, clamp((rootCenterMass - 1.4) / 8.5, 0, 1))
      : 0;

    children.forEach((child, index) => {
      const angle = nextAngleFor(node, child, offsets[index], siblingCount);
      const length = branchLength(child);
      const position = pointAtAngle(node.target, angle, length);

      if (!node.parentId && Math.abs(offsets[index]) > 0.04) {
        const outward = Math.sign(offsets[index]) * rootLateralPush * Math.pow(Math.abs(offsets[index]), 0.92);
        position.x += outward;
        position.y -= Math.abs(outward) * 0.04;
      }

      child.target = {
        x: position.x,
        y: position.y,
        angle,
        thickness: child.stats.girth,
      };

      layoutNode(child.id);
    });
  }

  function layoutTree() {
    assignChildSides(state.rootId);
    collectStats(state.rootId);
    branchThickness(state.rootId);
    layoutNode(state.rootId);
  }

  function runAnimationLoop() {
    cancelAnimationFrame(state.rafId);

    const tick = (now) => {
      state.lastNow = now;
      updateAnimation(now);
      updateEmphasisAnimation(now);
      drawScene(now);

      if (state.animation || state.emphasisAnimation) {
        state.rafId = requestAnimationFrame(tick);
      }
    };

    state.rafId = requestAnimationFrame(tick);
  }

  function updateAnimation(now) {
    const animation = state.animation;

    if (!animation) {
      for (const node of state.nodes.values()) {
        node.render = {
          x: node.target.x,
          y: node.target.y,
          angle: node.target.angle,
          thickness: node.target.thickness,
          visibility: 1,
          emphasis: node.render.emphasis ?? 1,
        };
      }
      return;
    }

    const growT = clamp((now - animation.start) / GROW_DURATION, 0, 1);
    const settleMix = easeOutSine(clamp(growT * 1.08, 0, 1));
    const growthMix = easeInOutCubic(growT);

    for (const node of state.nodes.values()) {
      if (animation.newChildIds.has(node.id)) continue;
      const mix = easeOutSine(clamp(growT * 1.15, 0, 1));

      node.render = {
        x: lerp(node.from.x, node.target.x, mix),
        y: lerp(node.from.y, node.target.y, mix),
        angle: lerpAngle(node.from.angle, node.target.angle, mix),
        thickness: lerp(node.from.thickness, node.target.thickness, mix),
        visibility: 1,
        emphasis: node.render.emphasis ?? 1,
      };
    }

    for (const nodeId of animation.newChildIds) {
      const node = state.nodes.get(nodeId);
      if (!node) continue;

      const parent = node.parentId ? state.nodes.get(node.parentId) : null;
      const settledPose = {
        x: lerp(node.from.x, node.target.x, settleMix),
        y: lerp(node.from.y, node.target.y, settleMix),
        angle: lerpAngle(node.from.angle, node.target.angle, settleMix),
        thickness: lerp(node.from.thickness, node.target.thickness, settleMix),
      };

      if (!parent) {
        node.render = {
          ...settledPose,
          visibility: clamp(growthMix * 1.04, 0, 1),
          emphasis: node.render.emphasis ?? 1,
        };
        continue;
      }

      const geometry = branchGeometryFromPoses(
        {
          x: parent.render.x,
          y: parent.render.y,
          angle: parent.render.angle,
        },
        settledPose,
        node,
      );
      const tipPoint = branchPointAt(geometry, growthMix);
      const tipTangent = normalize(branchTangentAt(geometry, Math.max(0.02, growthMix)));

      node.render = {
        x: tipPoint.x,
        y: tipPoint.y,
        angle: Math.atan2(tipTangent.y, tipTangent.x),
        thickness: lerp(node.from.thickness, node.target.thickness, Math.pow(growthMix, 0.88)),
        visibility: clamp(growthMix * 1.05, 0, 1),
        emphasis: node.render.emphasis ?? 1,
      };
    }

    if (now >= animation.end) {
      state.animation = null;
      updateAnimation(now);
    }
  }

  function updateEmphasisAnimation(now) {
    const animation = state.emphasisAnimation;

    if (!animation) {
      for (const node of state.nodes.values()) {
        node.render.emphasis = node.targetEmphasis ?? 1;
      }
      return;
    }

    const mix = easeInOutCubic(clamp((now - animation.start) / EMPHASIS_FADE_DURATION, 0, 1));
    for (const node of state.nodes.values()) {
      node.render.emphasis = lerp(node.fromEmphasis ?? 1, node.targetEmphasis ?? 1, mix);
    }

    if (now >= animation.end) {
      state.emphasisAnimation = null;
      updateEmphasisAnimation(now);
    }
  }

  function cubicBezierPoint(a, b, c, d, t) {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    const x =
      a.x * mt2 * mt +
      3 * b.x * mt2 * t +
      3 * c.x * mt * t2 +
      d.x * t2 * t;
    const y =
      a.y * mt2 * mt +
      3 * b.y * mt2 * t +
      3 * c.y * mt * t2 +
      d.y * t2 * t;
    return { x, y };
  }

  function cubicBezierTangent(a, b, c, d, t) {
    const mt = 1 - t;
    const x =
      3 * mt * mt * (b.x - a.x) +
      6 * mt * t * (c.x - b.x) +
      3 * t * t * (d.x - c.x);
    const y =
      3 * mt * mt * (b.y - a.y) +
      6 * mt * t * (c.y - b.y) +
      3 * t * t * (d.y - c.y);
    return { x, y };
  }

  function branchGeometryFromPoses(startPose, endPose, child) {
    const dirA = { x: Math.cos(startPose.angle), y: Math.sin(startPose.angle) };
    const dirB = { x: Math.cos(endPose.angle), y: Math.sin(endPose.angle) };
    const join = { x: startPose.x, y: startPose.y };
    const end = { x: endPose.x, y: endPose.y };
    const rawDx = end.x - join.x;
    const rawDy = end.y - join.y;
    const rawLength = Math.hypot(rawDx, rawDy) || 1;
    const overlap = Math.min(
      rawLength * 0.2,
      Math.max(6, (startPose.thickness || endPose.thickness || 10) * BRANCH_RENDER_SCALE * 0.72),
    );
    const start = {
      x: join.x - dirA.x * overlap,
      y: join.y - dirA.y * overlap,
    };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    const straight = { x: dx / length, y: dy / length };
    const curvePerp = perpendicular(straight);

    const bendStrength =
      length * (0.07 + child.seed.warp * 0.06) * (child.side || (child.seed.lean >= 0 ? 1 : -1));
    const bend = bendStrength;
    const crook = (child.seed.curve - 0.5) * length * 0.08;

    const mid = {
      x: lerp(start.x, end.x, 0.54) + curvePerp.x * bend + straight.x * crook,
      y: lerp(start.y, end.y, 0.54) + curvePerp.y * bend + straight.y * crook,
    };

    const cp1 = {
      x: start.x + dirA.x * length * 0.24 + curvePerp.x * bend * 0.24,
      y: start.y + dirA.y * length * 0.24 + curvePerp.y * bend * 0.24,
    };
    const cp2 = {
      x: mid.x - straight.x * length * 0.13 + curvePerp.x * bend * 0.28,
      y: mid.y - straight.y * length * 0.13 + curvePerp.y * bend * 0.28,
    };
    const cp3 = {
      x: mid.x + straight.x * length * 0.13 - curvePerp.x * bend * 0.22,
      y: mid.y + straight.y * length * 0.13 - curvePerp.y * bend * 0.22,
    };
    const cp4 = {
      x: end.x - dirB.x * length * 0.24 + curvePerp.x * bend * 0.16,
      y: end.y - dirB.y * length * 0.24 + curvePerp.y * bend * 0.16,
    };

    return {
      start,
      end,
      cp1,
      cp2,
      mid,
      cp3,
      cp4,
      centerline: `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}
    C ${cp1.x.toFixed(2)} ${cp1.y.toFixed(2)}, ${cp2.x.toFixed(2)} ${cp2.y.toFixed(2)}, ${mid.x.toFixed(2)} ${mid.y.toFixed(2)}
    C ${cp3.x.toFixed(2)} ${cp3.y.toFixed(2)}, ${cp4.x.toFixed(2)} ${cp4.y.toFixed(2)}, ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
    };
  }

  function branchGeometry(parent, child) {
    return branchGeometryFromPoses(parent.render, child.render, child);
  }

  function branchPointAt(geometry, t) {
    if (t <= 0.5) {
      return cubicBezierPoint(geometry.start, geometry.cp1, geometry.cp2, geometry.mid, t * 2);
    }

    return cubicBezierPoint(
      geometry.mid,
      geometry.cp3,
      geometry.cp4,
      geometry.end,
      (t - 0.5) * 2,
    );
  }

  function branchTangentAt(geometry, t) {
    if (t <= 0.5) {
      return cubicBezierTangent(
        geometry.start,
        geometry.cp1,
        geometry.cp2,
        geometry.mid,
        t * 2,
      );
    }

    return cubicBezierTangent(
      geometry.mid,
      geometry.cp3,
      geometry.cp4,
      geometry.end,
      (t - 0.5) * 2,
    );
  }

  function outlinePathFromGeometry(geometry, startWidth, endWidth, samples) {
    const left = [];
    const right = [];

    for (let index = 0; index <= samples; index += 1) {
      const t = index / samples;
      const point = branchPointAt(geometry, t);
      const tangent = normalize(branchTangentAt(geometry, t));
      const normal = perpendicular(tangent);
      const width = lerp(startWidth, endWidth, Math.pow(t, 0.8));

      left.push({
        x: point.x + normal.x * width,
        y: point.y + normal.y * width,
      });
      right.push({
        x: point.x - normal.x * width,
        y: point.y - normal.y * width,
      });
    }

    const leftStart = left[0];
    const rightEnd = right[right.length - 1];
    const rightReturn = right.slice(0, -1).reverse();
    const startTangent = normalize(branchTangentAt(geometry, 0.02));
    const endTangent = normalize(branchTangentAt(geometry, 0.98));
    const tipControl = {
      x: geometry.end.x + endTangent.x * endWidth * 1.35,
      y: geometry.end.y + endTangent.y * endWidth * 1.35,
    };
    const baseControl = {
      x: geometry.start.x - startTangent.x * startWidth * 1.1,
      y: geometry.start.y - startTangent.y * startWidth * 1.1,
    };

    const leftPath = left
      .map((point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
      )
      .join(" ");
    const rightPath = rightReturn
      .map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(" ");

    return `${leftPath}
      Q ${tipControl.x.toFixed(2)} ${tipControl.y.toFixed(2)} ${rightEnd.x.toFixed(2)} ${rightEnd.y.toFixed(2)}
      ${rightPath}
      Q ${baseControl.x.toFixed(2)} ${baseControl.y.toFixed(2)} ${leftStart.x.toFixed(2)} ${leftStart.y.toFixed(2)}
      Z`;
  }

  function branchSurfacePaths(geometry, startWidth, endWidth, samples) {
    return {
      shadow: outlinePathFromGeometry(geometry, startWidth * 1.08, endWidth * 1.08, samples),
      shell: outlinePathFromGeometry(geometry, startWidth, endWidth, samples),
    };
  }

  function barkStrokePath(geometry, startWidth, endWidth, options = {}) {
    const {
      offsetRatio = 0,
      startT = 0,
      endT = 1,
      samples = 12,
      phase = 0,
      waveFrequency = 2.2,
      waveStrength = 0.06,
      taper = 1,
    } = options;

    const points = [];
    for (let index = 0; index <= samples; index += 1) {
      const mix = index / samples;
      const t = lerp(startT, endT, mix);
      const point = branchPointAt(geometry, t);
      const tangent = normalize(branchTangentAt(geometry, t));
      const normal = perpendicular(tangent);
      const localWidth = lerp(startWidth, endWidth, Math.pow(t, 0.82));
      const envelope = Math.sin(Math.PI * mix) * taper;
      const jitter = Math.sin(t * Math.PI * waveFrequency + phase) * localWidth * waveStrength * envelope;
      const offset = localWidth * offsetRatio + jitter;

      points.push({
        x: point.x + normal.x * offset,
        y: point.y + normal.y * offset,
      });
    }

    return points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(" ");
  }

  function branchBarkTexture(geometry, startWidth, endWidth, seedA = 0.5, seedB = 0.5) {
    const averageWidth = (startWidth + endWidth) * 0.5;
    const ridgeCount = clamp(Math.round(averageWidth / 4.8), 3, 6);
    const strokes = [];

    for (let index = 0; index < ridgeCount; index += 1) {
      const spread = ridgeCount === 1 ? 0 : lerp(-0.44, 0.44, index / (ridgeCount - 1));
      const tShift = (index / Math.max(1, ridgeCount - 1) - 0.5) * 0.08;
      const startT = clamp(0.03 + seedA * 0.04 + Math.abs(spread) * 0.03 + tShift, 0.02, 0.18);
      const endT = clamp(0.92 - seedB * 0.05 - Math.abs(spread) * 0.07 - tShift, 0.74, 0.98);
      const width = Math.max(0.7, averageWidth * (0.08 - Math.abs(spread) * 0.03));
      const phase = seedA * Math.PI * 2 + index * 0.92;

      strokes.push({
        d: barkStrokePath(geometry, startWidth, endWidth, {
          offsetRatio: spread,
          startT,
          endT,
          samples: 11,
          phase,
          waveFrequency: 2 + seedB * 1.8 + index * 0.22,
          waveStrength: 0.05 + seedA * 0.025,
          taper: 0.94 - Math.abs(spread) * 0.18,
        }),
        width,
        opacity: clamp(0.15 + (1 - Math.abs(spread)) * 0.18, 0.12, 0.34),
        className: index % 2 === 0 ? "branch-bark-furrow" : "branch-bark-ridge",
      });
    }

    strokes.push({
      d: barkStrokePath(geometry, startWidth, endWidth, {
        offsetRatio: -0.1 + (seedB - 0.5) * 0.12,
        startT: 0.08,
        endT: 0.94,
        samples: 13,
        phase: Math.PI * (0.5 + seedB),
        waveFrequency: 3.1,
        waveStrength: 0.038,
        taper: 1,
      }),
      width: Math.max(0.85, averageWidth * 0.12),
      opacity: 0.3,
      className: "branch-bark-ridge",
    });

    return strokes;
  }

  function drawBranchSurface({
    paths,
    barkTexture = [],
    centerline,
    highlightWidth,
    gradientWidth,
    clipId,
    visibility = 1,
    emphasis = 1,
  }) {
    const visibilityAlpha = clamp(visibility, 0, 1);
    const emphasisAlpha = clamp(emphasis, DIMMED_TREE_OPACITY, 1);
    const shadowOpacity =
      (visibilityAlpha < 1 ? 0.32 + visibilityAlpha * 0.62 : 0.94) * emphasisAlpha;
    const shellOpacity = (visibilityAlpha < 1 ? visibilityAlpha : 0.98) * emphasisAlpha;
    const gradientOpacity = visibilityAlpha * emphasisAlpha;
    const highlightOpacity =
      (visibilityAlpha < 1
        ? visibilityAlpha * 0.18
        : clamp(0.16 + visibilityAlpha * 0.12, 0.08, 0.28)) * emphasisAlpha;

    const shadow = createSvgElement("path", {
      d: paths.shadow,
      class: "branch-shadow",
      opacity: shadowOpacity.toFixed(3),
    });
    const shell = createSvgElement("path", {
      d: paths.shell,
      class: "branch-shell",
      opacity: shellOpacity.toFixed(3),
    });
    const clipPath = createSvgElement("clipPath", {
      id: clipId,
      clipPathUnits: "userSpaceOnUse",
    });
    clipPath.append(createSvgElement("path", { d: paths.shell }));
    defs.append(clipPath);

    const reflectedGradient = createSvgElement("g", {
      "clip-path": `url(#${clipId})`,
      opacity: gradientOpacity.toFixed(3),
    });

    for (let index = 0; index < BRANCH_GRADIENT_LAYERS; index += 1) {
      const t = (index + 1) / BRANCH_GRADIENT_LAYERS;
      const widthScale = lerp(0.94, 0.16, easeOutSine(t));
      const color = rgbToCss(lerpColor(BRANCH_EDGE_RGB, BRANCH_CENTER_RGB, Math.pow(t, 0.92)));
      const stroke = createSvgElement("path", {
        d: centerline,
        class: "branch-gradient-stroke",
        stroke: color,
        "stroke-width": (gradientWidth * widthScale).toFixed(2),
        opacity: lerp(0.1, 0.78, Math.pow(t, 1.15)).toFixed(3),
      });
      reflectedGradient.append(stroke);
    }

    const barkGrain = createSvgElement("g", {
      "clip-path": `url(#${clipId})`,
      opacity: gradientOpacity.toFixed(3),
    });

    barkTexture.forEach((strokeData) => {
      barkGrain.append(
        createSvgElement("path", {
          d: strokeData.d,
          class: strokeData.className,
          "stroke-width": strokeData.width.toFixed(2),
          opacity: (strokeData.opacity * emphasisAlpha).toFixed(3),
        }),
      );
    });

    const highlight = createSvgElement("path", {
      d: centerline,
      class: "branch-highlight",
      "stroke-width": highlightWidth.toFixed(2),
      opacity: highlightOpacity.toFixed(3),
      stroke: rgbToCss(lerpColor(BRANCH_CENTER_RGB, BRANCH_HIGHLIGHT_RGB, 0.72)),
    });

    branchBackdrop.append(shadow);
    branchGroup.append(shell, reflectedGradient, barkGrain, highlight);
  }

  function rootBaseGeometry(node) {
    const end = { x: node.render.x, y: node.render.y };
    const baseLength = 66;
    const baseAngle = node.render.angle + Math.PI;
    const start = {
      x: end.x + Math.cos(baseAngle) * baseLength,
      y: end.y + Math.sin(baseAngle) * baseLength,
    };
    const baseDir = normalize({
      x: end.x - start.x,
      y: end.y - start.y,
    });
    const dirEnd = { x: Math.cos(node.render.angle), y: Math.sin(node.render.angle) };
    const mid = {
      x: lerp(start.x, end.x, 0.5),
      y: lerp(start.y, end.y, 0.5),
    };
    const cp1 = {
      x: start.x + baseDir.x * 28,
      y: start.y + baseDir.y * 28,
    };
    const cp2 = {
      x: mid.x - baseDir.x * 16,
      y: mid.y - baseDir.y * 16,
    };
    const cp3 = {
      x: mid.x + dirEnd.x * 12,
      y: mid.y + dirEnd.y * 12,
    };
    const cp4 = {
      x: end.x - dirEnd.x * 22,
      y: end.y - dirEnd.y * 22,
    };

    return {
      start,
      end,
      cp1,
      cp2,
      mid,
      cp3,
      cp4,
      centerline: `M ${start.x.toFixed(2)} ${start.y.toFixed(2)}
    C ${cp1.x.toFixed(2)} ${cp1.y.toFixed(2)}, ${cp2.x.toFixed(2)} ${cp2.y.toFixed(2)}, ${mid.x.toFixed(2)} ${mid.y.toFixed(2)}
    C ${cp3.x.toFixed(2)} ${cp3.y.toFixed(2)}, ${cp4.x.toFixed(2)} ${cp4.y.toFixed(2)}, ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
    };
  }

  function drawRootBase(node, emphasis = 1) {
    const geometry = rootBaseGeometry(node);
    const startWidth = node.render.thickness * 1.95 * BRANCH_RENDER_SCALE * 0.5;
    const endWidth = node.render.thickness * 1.02 * BRANCH_RENDER_SCALE * 0.5;
    drawBranchSurface({
      paths: branchSurfacePaths(geometry, startWidth, endWidth, 16),
      barkTexture: branchBarkTexture(geometry, startWidth, endWidth, 0.32, 0.61),
      centerline: geometry.centerline,
      highlightWidth: Math.max(1.1, endWidth * 0.24),
      gradientWidth: startWidth * 2,
      clipId: "branch-clip-root",
      emphasis,
    });
  }

  function attachNodeInteractions(target, node) {
    target.addEventListener("mouseenter", () => setHoverState(node.id, node.id));
    target.addEventListener("mouseleave", () => clearHoverState(node.id, node.id));
  }

  function attachBranchInteractions(target, nodeId) {
    target.addEventListener("mouseenter", () => setHoverState(nodeId, null));
    target.addEventListener("mouseleave", () => clearHoverState(nodeId, null));
  }

  function drawHoverTooltip(node) {
    const topic = node.label || "Untitled topic";
    const text = createSvgElement("text", {
      x: (node.render.x + 16).toFixed(2),
      y: (node.render.y - 16).toFixed(2),
      class: "topic-tooltip-text",
    });
    text.textContent = topic;
    nodeGroup.append(text);

    const bbox = text.getBBox();
    const paddingX = 10;
    const paddingY = 6;
    const left = clamp(bbox.x - paddingX, 8, WIDTH - bbox.width - paddingX * 2 - 8);
    const top = clamp(bbox.y - paddingY, 8, HEIGHT - bbox.height - paddingY * 2 - 8);
    text.setAttribute("x", (left + paddingX).toFixed(2));
    text.setAttribute("y", (top + paddingY + bbox.height - 4).toFixed(2));

    const plate = createSvgElement("rect", {
      x: left.toFixed(2),
      y: top.toFixed(2),
      width: (bbox.width + paddingX * 2).toFixed(2),
      height: (bbox.height + paddingY * 2).toFixed(2),
      rx: 12,
      class: "topic-tooltip-plate",
    });

    nodeGroup.insertBefore(plate, text);
  }

  function drawScene(now) {
    void now;
    defs.replaceChildren();
    branchBackdrop.replaceChildren();
    branchGroup.replaceChildren();
    tipGroup.replaceChildren();
    nodeGroup.replaceChildren();
    let clipIndex = 0;

    const nodes = [...state.nodes.values()].sort((a, b) => a.depth - b.depth);
    const root = state.nodes.get(state.rootId);
    if (root) {
      drawRootBase(root, root.render.emphasis ?? 1);
      const rootBranchHit = createSvgElement("path", {
        d: rootBaseGeometry(root).centerline,
        class: "branch-hit",
        "stroke-width": Math.max(26, root.render.thickness * 1.7).toFixed(2),
      });
      attachBranchInteractions(rootBranchHit, root.id);
      branchGroup.append(rootBranchHit);
    }

    for (const node of nodes) {
      if (!node.parentId) continue;
      const parent = state.nodes.get(node.parentId);
      const geometry = branchGeometry(parent, node);
      const startWidth = branchStartWidth(parent, node) * BRANCH_RENDER_SCALE * 0.5;
      const endWidth = branchEndWidth(node) * BRANCH_RENDER_SCALE * 0.5;
      const samples = node.slot === "trunk" ? 18 : 14;

      drawBranchSurface({
        paths: branchSurfacePaths(geometry, startWidth, endWidth, samples),
        barkTexture: branchBarkTexture(geometry, startWidth, endWidth, node.seed.curve, node.seed.warp),
        centerline: geometry.centerline,
        highlightWidth: Math.max(0.75, endWidth * 0.16),
        gradientWidth: startWidth * 2,
        clipId: `branch-clip-${clipIndex++}`,
        visibility: node.render.visibility,
        emphasis: node.render.emphasis ?? 1,
      });

      const branchHit = createSvgElement("path", {
        d: geometry.centerline,
        class: "branch-hit",
        "stroke-width": Math.max(22, (startWidth + endWidth) * 2.2).toFixed(2),
      });
      attachBranchInteractions(branchHit, node.id);
      branchGroup.append(branchHit);
    }

    for (const node of nodes) {
      const emphasis = node.render.emphasis ?? 1;
      if (!node.parentId) {
        const rootHit = createSvgElement("circle", {
          cx: node.render.x.toFixed(2),
          cy: node.render.y.toFixed(2),
          r: Math.max(24, node.render.thickness * 1.02).toFixed(2),
          class: "topic-hit",
        });
        attachNodeInteractions(rootHit, node);
        nodeGroup.append(rootHit);
        continue;
      }

      const glow = createSvgElement("circle", {
        cx: node.render.x.toFixed(2),
        cy: node.render.y.toFixed(2),
        r: Math.max(2.2, node.render.thickness * 0.42).toFixed(2),
        class: "node-glow",
        opacity: (0.46 * emphasis).toFixed(3),
      });
      const core = createSvgElement("circle", {
        cx: node.render.x.toFixed(2),
        cy: node.render.y.toFixed(2),
        r: Math.max(1.7, node.render.thickness * 0.18).toFixed(2),
        class: "node-core",
        opacity: emphasis.toFixed(3),
      });
      const hit = createSvgElement("circle", {
        cx: node.render.x.toFixed(2),
        cy: node.render.y.toFixed(2),
        r: Math.max(16, node.render.thickness * 1.18).toFixed(2),
        class: "topic-hit",
      });
      attachNodeInteractions(hit, node);

      nodeGroup.append(glow, core, hit);

      if (!node.children.length) {
        const bud = createSvgElement("circle", {
          cx: (node.render.x + Math.cos(node.render.angle) * 6).toFixed(2),
          cy: (node.render.y + Math.sin(node.render.angle) * 6).toFixed(2),
          r: 4.7,
          class: "blossom-bud",
          opacity: (0.88 * emphasis).toFixed(3),
        });
        nodeGroup.append(bud);
      }
    }

    const globallyDisabled = Boolean(state.animation);

    for (const node of nodes) {
      if (!canExpand(node)) continue;
      if (state.animation && node.id === state.animation.sourceId) continue;

      const anchor = growthBudAnchor(node);
      const emphasis = node.render.emphasis ?? 1;
      const classes = ["tip-button"];
      if (globallyDisabled || node.ui.loading) classes.push("is-disabled");
      if (node.ui.loading) classes.push("is-loading");
      if (node.ui.error) classes.push("is-error");

      const tipButton = createSvgElement("g", {
        class: classes.join(" "),
        transform: `translate(${anchor.x.toFixed(2)} ${anchor.y.toFixed(2)})`,
        tabindex: globallyDisabled || node.ui.loading ? -1 : 0,
        role: "button",
        "aria-label": `Expand ${node.label}`,
        opacity: emphasis.toFixed(3),
      });

      const glow = createSvgElement("circle", {
        class: "tip-glow",
        r: 10,
        opacity: 0.78,
      });
      const ring = createSvgElement("circle", {
        class: "tip-ring",
        r: 6.9,
      });
      const plusH = createSvgElement("line", {
        class: "tip-plus",
        x1: -2.6,
        y1: 0,
        x2: 2.6,
        y2: 0,
      });
      const plusV = createSvgElement("line", {
        class: "tip-plus",
        x1: 0,
        y1: -2.6,
        x2: 0,
        y2: 2.6,
      });

      if (!globallyDisabled && !node.ui.loading) {
        tipButton.addEventListener("click", () => state.onExpandRequest(node.id));
        tipButton.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            state.onExpandRequest(node.id);
          }
        });
      }

      tipButton.append(glow, ring, plusH, plusV);
      tipGroup.append(tipButton);
    }

    if (state.hoveredNodeId && state.nodes.has(state.hoveredNodeId)) {
      drawHoverTooltip(state.nodes.get(state.hoveredNodeId));
    }
  }

  function growthBudAnchor(node) {
    let angle;
    if (!node.parentId) {
      angle = -Math.PI / 2;
    } else {
      const nextCount = node.children.length + 1;
      const projectedOffsets = [...childLayoutOffsets(node), 0];
      projectedOffsets.sort((a, b) => a - b);
      const offset = projectedOffsets[projectedOffsets.length - 1] || childSpreadOffset(node.children.length, nextCount);
      const parent = state.nodes.get(node.parentId);
      const fanBase = childFanSpread(node, nextCount);
      const fan = parent ? fanBase * spreadMultiplier(parent, node, nextCount) : fanBase;
      const outwardBias = clamp((node.render.x - ROOT_X) / 330, -1, 1) * 0.11;
      angle =
        node.render.angle +
        offset * fan +
        outwardBias * (0.28 + Math.abs(offset) * 0.25) +
        node.seed.lean * 0.04;
    }

    const distance = node.parentId ? 24 : 30;
    return {
      x: node.render.x + Math.cos(angle) * distance,
      y: node.render.y + Math.sin(angle) * distance,
    };
  }

  function buildPath(nodeId) {
    const labels = [];
    let current = state.nodes.get(nodeId);

    while (current) {
      labels.push(current.label);
      current = current.parentId ? state.nodes.get(current.parentId) : null;
    }

    return labels.reverse();
  }

  function getNodeContext(nodeId) {
    const node = state.nodes.get(nodeId);
    const root = state.nodes.get(state.rootId);
    if (!node || !root) return null;

    return {
      rootTopic: root.label,
      nodeId: node.id,
      nodeLabel: node.label,
      summary: node.summary,
      depth: node.depth,
      expandable: node.expandable,
      path: buildPath(nodeId),
      existingChildren: node.children.map((childId) => state.nodes.get(childId)?.label).filter(Boolean),
    };
  }

  function serializeNode(node) {
    return {
      id: node.id,
      label: node.label,
      parentId: node.parentId,
      summary: node.summary,
      expandable: node.expandable,
      metadata: node.metadata,
    };
  }

  function getSnapshot() {
    if (!state.rootId) return null;

    const root = state.nodes.get(state.rootId);
    const nodes = [...state.nodes.values()]
      .filter((node) => node.id !== state.rootId)
      .map(serializeNode);

    return {
      root: serializeNode(root),
      nodes,
    };
  }

  return {
    appendChildren,
    getNodeContext,
    getSnapshot,
    patchNode,
    setExpandHandler,
    setNodeError,
    setNodeLoading,
    setTree,
  };
}
