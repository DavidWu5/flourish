const SVG_NS = "http://www.w3.org/2000/svg";

const WIDTH = 1000;
const HEIGHT = 720;
const ROOT_X = WIDTH / 2;
const ROOT_Y = HEIGHT - 130;
const TRUNK_BRANCH_LENGTH = 142;
const TRUNK_SPREAD_MIN = 0.18;
const TRUNK_SPREAD_MAX = 0.48;
const ROOT_BASE_LENGTH = 150;
const ROOT_BASE_START_WIDTH_MULTIPLIER = 3.18;
const ROOT_BASE_END_WIDTH_MULTIPLIER = 1.24;
const ROOT_LOADING_BRANCH_COUNT = 3;
const ROOT_LOADING_PROGRESS_FLOOR = 0.06;
const ROOT_LOADING_PROGRESS_CAP = 0.92;
const ROOT_LOADING_RISE_MS = 2300;
const ROOT_LOADING_PULSE_SPEED = 0.0034;
const GROW_DURATION = 1250;
const GROW_DURATION_VARIANCE = 320;
const GROW_STAGGER_BASE = 82;
const GROW_STAGGER_VARIANCE = 64;
const MIDDLE_BRANCH_START_ADVANCE = 110;
const MIDDLE_BRANCH_DURATION_MULTIPLIER = 0.76;
const BRANCH_ENCHANT_TRAVEL_PORTION = 0.78;
const BRANCH_ENCHANT_TRAIL_BASE = 0.16;
const BRANCH_ENCHANT_TRAIL_MAX = 0.42;
const HORIZONTAL_FAN_SPREAD_MULTIPLIER = 1.24;
const CHILD_LAYOUT_GAP_BASE = 1.04;
const CHILD_LAYOUT_GAP_DEPTH_BONUS = 0.16;
const ROOT_LATERAL_PUSH_MAX = 118;
const BRANCH_CROWD_LENGTH_BOOST = 0.14;
const EMPHASIS_FADE_DURATION = 180;
const BRANCH_RENDER_SCALE = 0.9;
const DIMMED_TREE_OPACITY = 0.18;
// Flip this to false for a perfectly still branch silhouette.
const BRANCH_TURBULENCE_ENABLED = true;
const BRANCH_TURBULENCE_SPEED = 0.00052;
const BRANCH_TURBULENCE_STRENGTH = 0.5;
const ENCHANT_GLOW_RGB = { r: 232, g: 240, b: 240 };
const ENCHANT_CORE_RGB = { r: 242, g: 189, b: 208 };
const ENCHANT_SPARK_RGB = { r: 125, g: 202, b: 216 };

export function createTreeRenderer({
  svg,
  branchBackdrop,
  branchGroup,
  tipGroup,
  nodeGroup,
}) {
  const state = {
    nodes: new Map(),
    rootId: null,
    animation: null,
    emphasisAnimation: null,
    rafId: 0,
    lastNow: performance.now(),
    viewportScale: 1,
    rootLoading: {
      active: false,
      startedAt: 0,
      placeholderIds: [],
    },
    hoverPathNodeId: null,
    hoveredNodeId: null,
    selectedNodeId: null,
    onExpandRequest: () => {},
    onHoverChange: () => {},
    onNodeSelect: () => {},
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
      description: data.description || data.summary || "",
      metadata: data.metadata || {},
      parentId: data.parentId ?? null,
      children: [],
      depth: 0,
      slot: data.parentId ? "branch" : "root",
      side: 0,
      expandable: data.expandable !== false,
      seed: randomSeeds(),
      loadingPlaceholder: Boolean(data.loadingPlaceholder),
      loadingPhase: Number(data.loadingPhase) || 0,
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

  function loadingPlaceholderId(index) {
    return `__root-loading-${index}`;
  }

  function loadingPlaceholderSeed(index) {
    const side = childSpreadOffset(index, ROOT_LOADING_BRANCH_COUNT);
    return {
      curve: 0.24 + index * 0.18,
      warp: 0.32 + index * 0.14,
      lean: side * 0.65,
      length: 0.26 + index * 0.22,
    };
  }

  function isLoadingPlaceholder(node) {
    return Boolean(node?.loadingPlaceholder);
  }

  function realChildren(node) {
    if (!node) return [];
    return node.children
      .map((childId) => state.nodes.get(childId))
      .filter((child) => child && !isLoadingPlaceholder(child));
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

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function easeOutBack(t, overshoot = 0.72) {
    const c1 = overshoot;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
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

  function branchMotion(node, now) {
    if (!BRANCH_TURBULENCE_ENABLED || !node?.parentId) return null;

    const time = now * BRANCH_TURBULENCE_SPEED;
    const depthFactor = lerp(0.5, 1, clamp(node.depth / 6, 0, 1));
    const slotFactor = node.slot === "trunk" ? 0.46 : 1;
    const amplitude = BRANCH_TURBULENCE_STRENGTH * depthFactor * slotFactor;
    const phaseA = node.seed.curve * Math.PI * 2 + node.depth * 0.63 + node.side * 0.9;
    const phaseB = node.seed.warp * Math.PI * 2 + node.depth * 0.47;
    const swayWave = Math.sin(time + phaseA);
    const rippleWave = Math.sin(time * 1.7 + phaseB);
    const counterWave = Math.cos(time * 0.72 + node.seed.length * Math.PI * 2);

    return {
      bendScale: 1 + swayWave * amplitude * 0.52,
      crookOffset: rippleWave * amplitude * 0.18,
      startAngleOffset: counterWave * amplitude * 0.1,
      endAngleOffset: swayWave * amplitude * 0.22,
      edgeWavePhase: phaseB + time * 1.3,
      edgeWaveStrength: amplitude * 0.28,
      poseShiftX: swayWave * amplitude * 8.5,
      poseShiftY: -Math.abs(swayWave) * amplitude * 1.4 + rippleWave * amplitude * 0.75,
      poseAngleOffset: swayWave * amplitude * 0.12,
    };
  }

  function applyPoseMotion(basePose, motion) {
    if (!motion) return { ...basePose };

    return {
      x: basePose.x + motion.poseShiftX,
      y: basePose.y + motion.poseShiftY,
      angle: basePose.angle + motion.poseAngleOffset,
      thickness: basePose.thickness,
    };
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
    return (
      lerp(0.34, 0.96, density) *
      lerp(1.08, 0.74, depthT) *
      HORIZONTAL_FAN_SPREAD_MULTIPLIER
    );
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
      crowdPressure * 0.18
    );
  }

  function childLayoutOffsets(node) {
    const children = node.children.map((childId) => state.nodes.get(childId));
    if (children.length <= 1) return [0];

    const weights = children.map((child) =>
      Math.max(1, child.stats.crown * 0.82 + child.stats.girth * 0.34),
    );
    const gap = CHILD_LAYOUT_GAP_BASE + clamp(node.depth / 8, 0, 1) * CHILD_LAYOUT_GAP_DEPTH_BONUS;
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
    return Boolean(node.expandable) && node.children.length === 0;
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
    if (Object.hasOwn(patch, "description")) {
      node.description = patch.description || patch.summary || "";
    } else if (Object.hasOwn(patch, "summary") && !node.description) {
      node.description = patch.summary || "";
    }
    if (Object.hasOwn(patch, "metadata")) node.metadata = patch.metadata || {};
    if (Object.hasOwn(patch, "expandable")) node.expandable = patch.expandable !== false;
  }

  function rootLoadingProgress(now = state.lastNow) {
    if (!state.rootLoading.active) return 0;

    const elapsed = Math.max(0, now - (state.rootLoading.startedAt || now));
    return clamp(
      (1 - Math.exp(-elapsed / ROOT_LOADING_RISE_MS)) * ROOT_LOADING_PROGRESS_CAP,
      ROOT_LOADING_PROGRESS_FLOOR,
      ROOT_LOADING_PROGRESS_CAP,
    );
  }

  function rootLoadingPulse(node, now = state.lastNow) {
    if (!isLoadingPlaceholder(node)) return null;

    const elapsed = Math.max(0, now - (state.rootLoading.startedAt || now));
    const pulseBase = (Math.sin(elapsed * ROOT_LOADING_PULSE_SPEED + node.loadingPhase) + 1) * 0.5;
    return {
      opacity:
        lerp(0.12, 0.28, pulseBase) * lerp(0.76, 1, Math.max(rootLoadingProgress(now), 0)),
    };
  }

  function ensureRootLoadingPlaceholders() {
    const root = state.nodes.get(state.rootId);
    if (!root || realChildren(root).length > 0) return;

    const existingPlaceholders = root.children.filter((childId) =>
      isLoadingPlaceholder(state.nodes.get(childId)),
    );
    state.rootLoading.placeholderIds = existingPlaceholders.slice();
    if (existingPlaceholders.length === ROOT_LOADING_BRANCH_COUNT) return;

    if (existingPlaceholders.length) {
      clearRootLoadingPlaceholders();
    }

    for (let index = 0; index < ROOT_LOADING_BRANCH_COUNT; index += 1) {
      const child = createVisualNode({
        id: loadingPlaceholderId(index),
        parentId: root.id,
        label: `Loading branch ${index + 1}`,
        summary: "",
        description: "",
        expandable: false,
        loadingPlaceholder: true,
        loadingPhase: index * 0.82,
      });
      child.seed = loadingPlaceholderSeed(index);
      child.from = {
        x: root.render.x,
        y: root.render.y,
        angle: root.render.angle,
        thickness: Math.max(1.4, root.render.thickness * 0.74),
      };
      child.render = {
        ...child.from,
        visibility: 0.0001,
        emphasis: root.render.emphasis ?? 1,
      };
      state.nodes.set(child.id, child);
      root.children.push(child.id);
      state.rootLoading.placeholderIds.push(child.id);
    }

    hydrateHierarchy(state.rootId);
    layoutTree();
  }

  function clearRootLoadingPlaceholders() {
    const root = state.nodes.get(state.rootId);
    if (!root) return false;

    const placeholderIds = new Set(
      root.children.filter((childId) => isLoadingPlaceholder(state.nodes.get(childId))),
    );
    if (!placeholderIds.size) {
      state.rootLoading.placeholderIds = [];
      return false;
    }

    root.children = root.children.filter((childId) => !placeholderIds.has(childId));
    placeholderIds.forEach((nodeId) => {
      state.nodes.delete(nodeId);
    });
    state.rootLoading.placeholderIds = [];

    hydrateHierarchy(state.rootId);
    layoutTree();
    return true;
  }

  function setSelectedNode(nodeId = null) {
    state.selectedNodeId = nodeId && state.nodes.has(nodeId) ? nodeId : null;
    state.onNodeSelect(state.selectedNodeId ? getNodeDetails(state.selectedNodeId) : null);
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
    state.onHoverChange(hoveredNodeId ? getNodeDetails(hoveredNodeId) : null);
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
    state.rootLoading.active = false;
    state.rootLoading.startedAt = 0;
    state.rootLoading.placeholderIds = [];
    state.hoverPathNodeId = null;
    state.hoveredNodeId = null;
    state.selectedNodeId = null;
    state.onHoverChange(null);
    state.onNodeSelect(null);

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

    if (BRANCH_TURBULENCE_ENABLED) {
      runAnimationLoop();
      return;
    }

    drawScene(performance.now());
  }

  function appendChildren(parentId, childNodes) {
    const parent = state.nodes.get(parentId);
    if (!parent) {
      if (!state.animation) drawScene(state.lastNow);
      return;
    }

    const freshNodes = [];
    const now = performance.now();
    const existingLabels = new Set(
      realChildren(parent)
        .map((child) => child.label?.trim().toLowerCase())
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

    const placeholderIds =
      parentId === state.rootId ? state.rootLoading.placeholderIds.filter((nodeId) => state.nodes.has(nodeId)) : [];
    let adoptedPlaceholders = 0;
    const continuedNodeIds = new Set();

    for (const data of childNodes) {
      const labelKey = data.label?.trim().toLowerCase();
      if (state.nodes.has(data.id) || (labelKey && existingLabels.has(labelKey))) continue;
      let child;
      const placeholderId = placeholderIds[adoptedPlaceholders];

      if (placeholderId) {
        child = state.nodes.get(placeholderId);
        if (!child) continue;
        const parentIndex = parent.children.indexOf(placeholderId);
        const currentRender = {
          x: child.render.x,
          y: child.render.y,
          angle: child.render.angle,
          thickness: child.render.thickness,
        };
        state.nodes.delete(placeholderId);
        child.id = data.id;
        child.parentId = parentId;
        child.loadingPlaceholder = false;
        child.loadingPhase = 0;
        patchPublicNode(child, data);
        child.from = currentRender;
        child.render = {
          ...currentRender,
          visibility: Math.max(child.render.visibility ?? 0.0001, 0.0001),
          emphasis: child.render.emphasis ?? parent.render.emphasis ?? 1,
        };
        state.nodes.set(child.id, child);
        if (parentIndex >= 0) {
          parent.children[parentIndex] = child.id;
        }
        adoptedPlaceholders += 1;
        continuedNodeIds.add(child.id);
      } else {
        child = createVisualNode({ ...data, parentId });
        state.nodes.set(child.id, child);
        parent.children.push(child.id);
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
      }

      if (labelKey) existingLabels.add(labelKey);
      freshNodes.push(child.id);
    }

    const unusedPlaceholderIds = placeholderIds.slice(adoptedPlaceholders);
    if (unusedPlaceholderIds.length) {
      parent.children = parent.children.filter((childId) => !unusedPlaceholderIds.includes(childId));
      unusedPlaceholderIds.forEach((nodeId) => {
        state.nodes.delete(nodeId);
      });
    }
    if (placeholderIds.length) {
      state.rootLoading.placeholderIds = [];
    }

    if (!freshNodes.length) {
      if (placeholderIds.length) {
        hydrateHierarchy(state.rootId);
        layoutTree();
        updateAnimation(now);
      }
      if (state.hoveredNodeId === parentId) {
        state.onHoverChange(getNodeDetails(parentId));
      }
      if (state.selectedNodeId === parentId) {
        state.onNodeSelect(getNodeDetails(parentId));
      }
      drawScene(now);
      return;
    }

    hydrateHierarchy(state.rootId);
    layoutTree();

    const childTimings = new Map();
    let animationEnd = now;
    const centerChildId =
      freshNodes.length >= 3 && freshNodes.length % 2 === 1
        ? freshNodes.find((nodeId) => Math.abs(state.nodes.get(nodeId)?.side || 1) < 0.001) || null
        : null;

    freshNodes.forEach((nodeId, index) => {
      const child = state.nodes.get(nodeId);
      if (!child) return;
      const isMiddleChild = nodeId === centerChildId;
      const continuesFromPreview = continuedNodeIds.has(nodeId);
      const initialGrowT = continuesFromPreview ? clamp(rootLoadingProgress(now), 0, 0.98) : 0;

      const startOffset = continuesFromPreview
        ? 0
        : Math.max(
            0,
            index * GROW_STAGGER_BASE +
              lerp(0, GROW_STAGGER_VARIANCE, child.seed.curve) -
              (isMiddleChild ? MIDDLE_BRANCH_START_ADVANCE : 0),
          );
      const durationBase =
        GROW_DURATION + lerp(-GROW_DURATION_VARIANCE, GROW_DURATION_VARIANCE, child.seed.length);
      const continuationScale = continuesFromPreview
        ? Math.max(0.22, 1 - initialGrowT)
        : 1;
      const duration =
        (isMiddleChild && !continuesFromPreview
          ? durationBase * MIDDLE_BRANCH_DURATION_MULTIPLIER
          : durationBase) * continuationScale;
      const start = now + startOffset;
      const end = start + duration;

      childTimings.set(nodeId, {
        start,
        end,
        duration,
        initialGrowT,
        continuesFromPreview,
      });
      animationEnd = Math.max(animationEnd, end);
    });

    state.animation = {
      newChildIds: new Set(freshNodes),
      childTimings,
      sourceId: parentId,
      start: now,
      end: animationEnd,
    };

    if (state.hoveredNodeId === parentId) {
      state.onHoverChange(getNodeDetails(parentId));
    }
    if (state.selectedNodeId === parentId) {
      state.onNodeSelect(getNodeDetails(parentId));
    }

    runAnimationLoop();
  }

  function insertParent(targetNodeId, newNodeData) {
    const target = state.nodes.get(targetNodeId);
    if (!target || !target.parentId) return;
    const oldParentId = target.parentId;
    const oldParent = state.nodes.get(oldParentId);
    if (!oldParent) return;

    for (const node of state.nodes.values()) {
      node.from = {
        x: node.render.x,
        y: node.render.y,
        angle: node.render.angle,
        thickness: node.render.thickness,
      };
    }

    const newNode = createVisualNode({ ...newNodeData, parentId: oldParentId });
    state.nodes.set(newNode.id, newNode);

    oldParent.children = oldParent.children.filter((id) => id !== targetNodeId);
    oldParent.children.push(newNode.id);
    newNode.children.push(targetNodeId);
    target.parentId = newNode.id;

    newNode.from = {
      x: oldParent.render.x,
      y: oldParent.render.y,
      angle: oldParent.render.angle,
      thickness: Math.max(1.4, oldParent.render.thickness * 0.74),
    };
    newNode.render = { ...newNode.from, visibility: 0.0001, emphasis: 1 };

    hydrateHierarchy(state.rootId);
    layoutTree();

    const now = performance.now();
    state.animation = {
      newChildIds: new Set([newNode.id]),
      childTimings: new Map([[newNode.id, { start: now, end: now + GROW_DURATION, duration: GROW_DURATION }]]),
      sourceId: oldParentId,
      start: now,
      end: now + GROW_DURATION,
    };
    runAnimationLoop();
  }

  function setExpandHandler(handler) {
    state.onExpandRequest = handler;
  }

  function setHoverHandler(handler) {
    state.onHoverChange = typeof handler === "function" ? handler : () => {};
  }

  function setNodeSelectHandler(handler) {
    state.onNodeSelect = typeof handler === "function" ? handler : () => {};
  }

  function setViewportScale(scale = 1) {
    const nextScale = Math.max(0.01, Number(scale) || 1);
    if (Math.abs(nextScale - state.viewportScale) < 0.001) return;
    state.viewportScale = nextScale;
    if (!state.animation) {
      drawScene(state.lastNow);
    }
  }

  function setRootLoading(active) {
    const nextActive = Boolean(active);
    if (nextActive) {
      if (!state.rootLoading.active) {
        state.rootLoading.startedAt = performance.now();
      }
      state.rootLoading.active = true;
      ensureRootLoadingPlaceholders();
      runAnimationLoop();
      return;
    }

    if (!state.rootLoading.active && !state.rootLoading.placeholderIds.length) return;
    state.rootLoading.active = false;
    state.rootLoading.startedAt = 0;
    clearRootLoadingPlaceholders();
    if (!state.animation) {
      updateAnimation(state.lastNow);
      drawScene(state.lastNow);
    }
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
    if (state.hoveredNodeId === nodeId) {
      state.onHoverChange(getNodeDetails(nodeId));
    }
    if (state.selectedNodeId === nodeId) {
      state.onNodeSelect(getNodeDetails(nodeId));
    }
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
    if (node.slot === "trunk") return TRUNK_BRANCH_LENGTH;

    const siblingCount = node.parentId ? state.nodes.get(node.parentId).children.length : 1;
    const depthScale = Math.pow(0.81, Math.max(0, node.depth - 2));
    const vigor = 0.95 + Math.min(0.24, node.stats.weight * 0.06);
    const noise = 0.9 + node.seed.length * 0.18;
    const crowdScale =
      lerp(1.04, 0.92, clamp((siblingCount - 1) / 4, 0, 1)) +
      clamp((siblingCount - 1) / 4, 0, 1) * BRANCH_CROWD_LENGTH_BOOST;
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
      const spread = lerp(
        TRUNK_SPREAD_MIN,
        TRUNK_SPREAD_MAX,
        clamp((siblingCount - 1) / 4, 0, 1),
      );
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
      ? lerp(0, ROOT_LATERAL_PUSH_MAX, clamp((rootCenterMass - 1.4) / 8.5, 0, 1))
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

      if (
        state.animation ||
        state.emphasisAnimation ||
        state.rootLoading.active ||
        BRANCH_TURBULENCE_ENABLED
      ) {
        state.rafId = requestAnimationFrame(tick);
      }
    };

    state.rafId = requestAnimationFrame(tick);
  }

  function buildGrowthState(localGrowT, options = {}) {
    const initialGrowT = clamp(options.initialGrowT ?? 0, 0, 0.98);
    const completionT = clamp(options.completionT ?? 0, 0, 1);
    const settleMix = easeOutBack(clamp(localGrowT * 1.03, 0, 1), 0.68);
    const tipGrowthMix = easeOutCubic(clamp(localGrowT * 1.02, 0, 1));
    const thicknessMix = easeOutCubic(clamp((localGrowT - 0.14) / 0.86, 0, 1));
    const growthBendScale = 1 + Math.sin(tipGrowthMix * Math.PI) * 0.14;

    const dissolveStart = BRANCH_ENCHANT_TRAVEL_PORTION;
    const enchantHead = localGrowT > 0 ? 1 : 0;
    const dissipate = clamp(
      (tipGrowthMix - dissolveStart) / (1 - dissolveStart),
      0,
      1,
    );
    const trailLength = lerp(
      BRANCH_ENCHANT_TRAIL_BASE,
      BRANCH_ENCHANT_TRAIL_MAX,
      dissipate,
    );
    const revealTail = clamp(tipGrowthMix - trailLength, 0, 1);
    const dissolveTail = lerp(0, 1, dissipate);
    const enchantTail =
      tipGrowthMix < dissolveStart
        ? revealTail
        : Math.max(revealTail, dissolveTail);
    const enchantOpacity =
      localGrowT <= 0
        ? 0
        : clamp(
            (1 - dissipate) *
              lerp(0.55, 1, Math.sin(Math.min(localGrowT, 1) * Math.PI)),
            0,
            1,
          );

    return {
      completionT,
      continuesFromPreview: Boolean(options.continuesFromPreview),
      initialGrowT,
      localGrowT,
      settleMix,
      tipGrowthMix,
      thicknessMix,
      growthBendScale,
      enchant: {
        head: enchantHead,
        tail: enchantTail,
        opacity: enchantOpacity,
        dissipate,
      },
    };
  }

  function getGrowthState(animation, nodeId, now) {
    const timing = animation.childTimings?.get(nodeId);
    const localDuration = Math.max(1, timing?.duration ?? GROW_DURATION);
    const initialGrowT = clamp(timing?.initialGrowT ?? 0, 0, 0.98);
    const completionT = clamp((now - (timing?.start ?? animation.start)) / localDuration, 0, 1);
    const localGrowT = lerp(initialGrowT, 1, completionT);
    return buildGrowthState(localGrowT, {
      completionT,
      initialGrowT,
      continuesFromPreview: timing?.continuesFromPreview,
    });
  }

  function applyGrowingBranchRender(node, parent, motion, growthState) {
    const {
      settleMix,
      tipGrowthMix,
      thicknessMix,
      growthBendScale,
    } = growthState;
    const settledPose = {
      x: lerp(node.from.x, node.target.x, settleMix),
      y: lerp(node.from.y, node.target.y, settleMix),
      angle: lerpAngle(node.from.angle, node.target.angle, settleMix),
      thickness: lerp(node.from.thickness, node.target.thickness, settleMix),
    };

    if (!parent) {
      node.render = {
        ...settledPose,
        visibility: clamp(tipGrowthMix * 1.04, 0, 1),
        emphasis: node.render.emphasis ?? 1,
      };
      return;
    }

    const geometry = branchGeometryFromPoses(
      {
        x: parent.render.x,
        y: parent.render.y,
        angle: parent.render.angle,
      },
      settledPose,
      node,
      {
        bendScale: growthBendScale * (motion?.bendScale ?? 1),
        crookOffset: motion?.crookOffset ?? 0,
        startAngleOffset: motion?.startAngleOffset ?? 0,
        endAngleOffset: motion?.endAngleOffset ?? 0,
      },
    );
    const tipPoint = branchPointAt(geometry, tipGrowthMix);
    const tipTangent = normalize(branchTangentAt(geometry, Math.max(0.02, tipGrowthMix)));

    node.render = {
      x: tipPoint.x,
      y: tipPoint.y,
      angle: Math.atan2(tipTangent.y, tipTangent.x),
      thickness: lerp(node.from.thickness, node.target.thickness, thicknessMix),
      visibility: clamp(tipGrowthMix * 1.05, 0, 1),
      emphasis: node.render.emphasis ?? 1,
    };
  }

  function updateAnimation(now) {
    const animation = state.animation;

    if (!animation) {
      const loadingProgress = rootLoadingProgress(now);
      for (const node of state.nodes.values()) {
        if (isLoadingPlaceholder(node) && state.rootLoading.active) {
          const parent = node.parentId ? state.nodes.get(node.parentId) : null;
          const motion = branchMotion(node, now);
          applyGrowingBranchRender(
            node,
            parent,
            motion,
            buildGrowthState(loadingProgress, {
              completionT: 0,
              initialGrowT: 0,
              continuesFromPreview: false,
            }),
          );
          continue;
        }

        const motion = branchMotion(node, now);
        const pose = applyPoseMotion(node.target, motion);
        node.render = {
          x: pose.x,
          y: pose.y,
          angle: pose.angle,
          thickness: pose.thickness,
          visibility: 1,
          emphasis: node.render.emphasis ?? 1,
        };
      }
      return;
    }

    const animationDuration = Math.max(1, animation.end - animation.start);
    const growT = clamp((now - animation.start) / animationDuration, 0, 1);

    for (const node of state.nodes.values()) {
      if (animation.newChildIds.has(node.id)) continue;
      const mix = easeOutSine(clamp(growT * 1.15, 0, 1));
      const motion = branchMotion(node, now);
      const basePose = {
        x: lerp(node.from.x, node.target.x, mix),
        y: lerp(node.from.y, node.target.y, mix),
        angle: lerpAngle(node.from.angle, node.target.angle, mix),
        thickness: lerp(node.from.thickness, node.target.thickness, mix),
      };
      const pose = applyPoseMotion(basePose, motion);

      node.render = {
        x: pose.x,
        y: pose.y,
        angle: pose.angle,
        thickness: pose.thickness,
        visibility: 1,
        emphasis: node.render.emphasis ?? 1,
      };
    }

    for (const nodeId of animation.newChildIds) {
      const node = state.nodes.get(nodeId);
      if (!node) continue;
      const growthState = getGrowthState(animation, nodeId, now);
      const {
        completionT,
        continuesFromPreview,
        settleMix,
        tipGrowthMix,
        thicknessMix,
        growthBendScale,
      } = growthState;

      const parent = node.parentId ? state.nodes.get(node.parentId) : null;
      const motion = branchMotion(node, now);

      if (continuesFromPreview) {
        const continuationMix = easeOutCubic(completionT);
        const basePose = {
          x: lerp(node.from.x, node.target.x, continuationMix),
          y: lerp(node.from.y, node.target.y, continuationMix),
          angle: lerpAngle(node.from.angle, node.target.angle, continuationMix),
          thickness: lerp(node.from.thickness, node.target.thickness, continuationMix),
        };
        const pose = applyPoseMotion(basePose, motion);

        node.render = {
          x: pose.x,
          y: pose.y,
          angle: pose.angle,
          thickness: pose.thickness,
          visibility: 1,
          emphasis: node.render.emphasis ?? 1,
        };
        continue;
      }

      applyGrowingBranchRender(node, parent, motion, growthState);
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

  function branchGeometryFromPoses(startPose, endPose, child, options = {}) {
    const {
      bendScale = 1,
      crookOffset = 0,
      startAngleOffset = 0,
      endAngleOffset = 0,
    } = options;
    const dirA = {
      x: Math.cos(startPose.angle + startAngleOffset),
      y: Math.sin(startPose.angle + startAngleOffset),
    };
    const dirB = {
      x: Math.cos(endPose.angle + endAngleOffset),
      y: Math.sin(endPose.angle + endAngleOffset),
    };
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
      length *
      (0.07 + child.seed.warp * 0.06) *
      (child.side || (child.seed.lean >= 0 ? 1 : -1)) *
      bendScale;
    const bend = bendStrength;
    const crook = (child.seed.curve - 0.5) * length * 0.08 + crookOffset * length * 0.04;

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

  function centerlineSegmentPath(geometry, startT, endT, samples = 18) {
    const from = clamp(startT, 0, 1);
    const to = clamp(endT, 0, 1);
    if (to - from <= 0.0005) return "";

    const points = [];
    for (let index = 0; index <= samples; index += 1) {
      const mix = index / samples;
      const t = lerp(from, to, mix);
      points.push(branchPointAt(geometry, t));
    }

    return points
      .map((point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
      )
      .join(" ");
  }

  function outlinePathFromGeometry(geometry, startWidth, endWidth, samples, options = {}) {
    const {
      edgeWavePhase = 0,
      edgeWaveStrength = 0,
      edgeWaveFrequency = 3.2,
    } = options;
    const left = [];
    const right = [];

    for (let index = 0; index <= samples; index += 1) {
      const t = index / samples;
      const point = branchPointAt(geometry, t);
      const tangent = normalize(branchTangentAt(geometry, t));
      const normal = perpendicular(tangent);
      const width = lerp(startWidth, endWidth, Math.pow(t, 0.8));
      const edgeEnvelope = Math.sin(Math.PI * t);
      const edgeWave =
        Math.sin(t * Math.PI * edgeWaveFrequency + edgeWavePhase) *
        edgeWaveStrength *
        edgeEnvelope;
      const leftWidth = Math.max(0.2, width * (1 + edgeWave));
      const rightWidth = Math.max(0.2, width * (1 - edgeWave * 0.9));

      left.push({
        x: point.x + normal.x * leftWidth,
        y: point.y + normal.y * leftWidth,
      });
      right.push({
        x: point.x - normal.x * rightWidth,
        y: point.y - normal.y * rightWidth,
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

  function branchSurfacePaths(geometry, startWidth, endWidth, samples, options = {}) {
    return {
      shadow: outlinePathFromGeometry(
        geometry,
        startWidth * 1.08,
        endWidth * 1.08,
        samples,
        options,
      ),
      shell: outlinePathFromGeometry(geometry, startWidth, endWidth, samples, options),
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
    visibility = 1,
    emphasis = 1,
  }) {
    const visibilityAlpha = clamp(visibility, 0, 1);
    const emphasisAlpha = clamp(emphasis, DIMMED_TREE_OPACITY, 1);
    const shellOpacity = visibilityAlpha * emphasisAlpha;
    const outlineGlow = createSvgElement("path", {
      d: paths.shell,
      class: "branch-outline-glow",
      opacity: (shellOpacity * 0.92).toFixed(3),
    });
    const shell = createSvgElement("path", {
      d: paths.shell,
      class: "branch-shell",
      opacity: shellOpacity.toFixed(3),
    });
    branchBackdrop.append(outlineGlow);
    branchGroup.append(shell);
  }

  function drawBranchPreviewPulse(paths, pulse, emphasis = 1) {
    if (!pulse || pulse.opacity <= 0.001) return;

    const glow = createSvgElement("path", {
      d: paths.shell,
      class: "branch-preview-pulse-glow",
      opacity: (pulse.opacity * 0.92 * emphasis).toFixed(3),
    });
    const shell = createSvgElement("path", {
      d: paths.shell,
      class: "branch-preview-pulse",
      opacity: (pulse.opacity * 0.56 * emphasis).toFixed(3),
    });

    branchBackdrop.append(glow);
    branchGroup.append(shell);
  }

  function drawBranchEnchant(
    geometry,
    startWidth,
    endWidth,
    progress,
    emphasis = 1,
  ) {
    if (!progress || progress.opacity <= 0.001 || progress.head <= progress.tail) return;

    const enchantPath = centerlineSegmentPath(geometry, progress.tail, progress.head, 16);
    if (!enchantPath) return;

    const trailWidth = lerp(startWidth, endWidth, Math.pow(progress.head, 0.72));
    const glow = createSvgElement("path", {
      d: enchantPath,
      class: "branch-enchant-glow",
      "stroke-width": Math.max(3.8, trailWidth * 2.9).toFixed(2),
      opacity: (progress.opacity * 0.3 * emphasis).toFixed(3),
      stroke: rgbToCss(ENCHANT_GLOW_RGB),
    });
    const core = createSvgElement("path", {
      d: enchantPath,
      class: "branch-enchant-core",
      "stroke-width": Math.max(1.6, trailWidth * 1.1).toFixed(2),
      opacity: (progress.opacity * 0.92 * emphasis).toFixed(3),
      stroke: rgbToCss(lerpColor(ENCHANT_CORE_RGB, ENCHANT_SPARK_RGB, progress.dissipate)),
    });

    branchGroup.append(glow, core);
  }

  function rootBaseGeometry(node) {
    const end = { x: node.render.x, y: node.render.y };
    const baseLength = ROOT_BASE_LENGTH;
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
    const startWidth =
      node.render.thickness * ROOT_BASE_START_WIDTH_MULTIPLIER * BRANCH_RENDER_SCALE * 0.5;
    const endWidth =
      node.render.thickness * ROOT_BASE_END_WIDTH_MULTIPLIER * BRANCH_RENDER_SCALE * 0.5;
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
    target.addEventListener("click", (event) => {
      event.preventDefault();
      setSelectedNode(node.id);
    });
    target.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      setSelectedNode(node.id);
    });
  }

  function nodeActionLabel(node) {
    if (!node) return "Select topic";
    return node.metadata?.question
      ? `Check understanding for ${node.label}`
      : `Select ${node.label}`;
  }

  function attachBranchInteractions(target, nodeId) {
    target.addEventListener("mouseenter", () => setHoverState(nodeId, null));
    target.addEventListener("mouseleave", () => clearHoverState(nodeId, null));
  }

  function drawHoverTooltip(node) {
    const viewportScale = state.viewportScale || 1;
    const uiScale = 1 / viewportScale;
    const topic = node.label || "Untitled topic";
    const text = createSvgElement("text", {
      x: (node.render.x + 16 * uiScale).toFixed(2),
      y: (node.render.y - 16 * uiScale).toFixed(2),
      class: "topic-tooltip-text",
    });
    text.style.fontSize = `${12 * uiScale}px`;
    text.textContent = topic;
    nodeGroup.append(text);

    const bbox = text.getBBox();
    const paddingX = 10 * uiScale;
    const paddingY = 6 * uiScale;
    const inset = 8 * uiScale;
    const left = clamp(
      bbox.x - paddingX,
      inset,
      WIDTH - bbox.width - paddingX * 2 - inset,
    );
    const top = clamp(
      bbox.y - paddingY,
      inset,
      HEIGHT - bbox.height - paddingY * 2 - inset,
    );
    text.setAttribute("x", (left + paddingX).toFixed(2));
    text.setAttribute("y", (top + paddingY + bbox.height - 4 * uiScale).toFixed(2));

    const plate = createSvgElement("rect", {
      x: left.toFixed(2),
      y: top.toFixed(2),
      width: (bbox.width + paddingX * 2).toFixed(2),
      height: (bbox.height + paddingY * 2).toFixed(2),
      rx: (12 * uiScale).toFixed(2),
      class: "topic-tooltip-plate",
      "stroke-width": uiScale.toFixed(3),
    });

    nodeGroup.insertBefore(plate, text);
  }

  function nodeStateClasses(node) {
    const meta = node?.metadata || {};
    const classes = [];
    if (meta.status === "complete") classes.push("is-complete");
    else if (meta.status === "locked") classes.push("is-locked");
    else if (meta.question) classes.push("is-pending");
    if (meta.kind === "prerequisite") classes.push("is-prereq");
    return classes.join(" ");
  }

  function drawScene(now) {
    const viewportScale = state.viewportScale || 1;
    const uiScale = 1 / viewportScale;
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
        "stroke-width": (Math.max(26, root.render.thickness * 1.7) * uiScale).toFixed(2),
      });
      attachBranchInteractions(rootBranchHit, root.id);
      branchGroup.append(rootBranchHit);
    }

    for (const node of nodes) {
      if (!node.parentId) continue;
      const parent = state.nodes.get(node.parentId);
      const motion = branchMotion(node, now);
      const geometry = branchGeometryFromPoses(parent.render, node.render, node, motion || {});
      const startWidth = branchStartWidth(parent, node) * BRANCH_RENDER_SCALE * 0.5;
      const endWidth = branchEndWidth(node) * BRANCH_RENDER_SCALE * 0.5;
      const samples = node.slot === "trunk" ? 18 : 14;
      const isPlaceholder = isLoadingPlaceholder(node);
      const paths = branchSurfacePaths(geometry, startWidth, endWidth, samples, motion || {});

      drawBranchSurface({
        paths,
        barkTexture: branchBarkTexture(geometry, startWidth, endWidth, node.seed.curve, node.seed.warp),
        centerline: geometry.centerline,
        highlightWidth: Math.max(0.75, endWidth * 0.16),
        gradientWidth: startWidth * 2,
        clipId: `branch-clip-${clipIndex++}`,
        visibility: node.render.visibility,
        emphasis: node.render.emphasis ?? 1,
      });

      if (isPlaceholder) {
        drawBranchPreviewPulse(paths, rootLoadingPulse(node, now), node.render.emphasis ?? 1);
      }

      const growthState =
        !isPlaceholder && state.animation && state.animation.newChildIds.has(node.id)
          ? getGrowthState(state.animation, node.id, now)
          : null;
      if (growthState?.enchant) {
        drawBranchEnchant(
          geometry,
          startWidth,
          endWidth,
          growthState.enchant,
          node.render.emphasis ?? 1,
        );
      }

      if (!isPlaceholder) {
        const branchHit = createSvgElement("path", {
          d: geometry.centerline,
          class: "branch-hit",
          "stroke-width": (Math.max(22, (startWidth + endWidth) * 2.2) * uiScale).toFixed(2),
        });
        attachBranchInteractions(branchHit, node.id);
        branchGroup.append(branchHit);
      }
    }

    for (const node of nodes) {
      if (isLoadingPlaceholder(node)) continue;
      const emphasis = node.render.emphasis ?? 1;
      if (!node.parentId) {
        const rootHit = createSvgElement("circle", {
          cx: node.render.x.toFixed(2),
          cy: node.render.y.toFixed(2),
          r: (Math.max(24, node.render.thickness * 1.02) * uiScale).toFixed(2),
          class: "topic-hit",
          tabindex: 0,
          role: "button",
          "aria-label": nodeActionLabel(node),
        });
        attachNodeInteractions(rootHit, node);
        nodeGroup.append(rootHit);
        continue;
      }

      const stateClass = nodeStateClasses(node);
      const stateSuffix = stateClass ? ` ${stateClass}` : "";
      const glow = createSvgElement("circle", {
        cx: node.render.x.toFixed(2),
        cy: node.render.y.toFixed(2),
        r: (Math.max(2.2, node.render.thickness * 0.42) * uiScale).toFixed(2),
        class: `node-glow${stateSuffix}`,
        opacity: (0.46 * emphasis).toFixed(3),
      });
      const core = createSvgElement("circle", {
        cx: node.render.x.toFixed(2),
        cy: node.render.y.toFixed(2),
        r: (Math.max(1.7, node.render.thickness * 0.18) * uiScale).toFixed(2),
        class: `node-core${stateSuffix}`,
        opacity: emphasis.toFixed(3),
      });
      const hit = createSvgElement("circle", {
        cx: node.render.x.toFixed(2),
        cy: node.render.y.toFixed(2),
        r: (Math.max(16, node.render.thickness * 1.18) * uiScale).toFixed(2),
        class: `topic-hit${stateSuffix}`,
        tabindex: 0,
        role: "button",
        "aria-label": nodeActionLabel(node),
      });
      attachNodeInteractions(hit, node);

      if (stateClass.includes("is-pending")) {
        const ring = createSvgElement("circle", {
          cx: node.render.x.toFixed(2),
          cy: node.render.y.toFixed(2),
          r: (Math.max(8, node.render.thickness * 0.7) * uiScale).toFixed(2),
          class: "node-pending-ring",
          opacity: (0.92 * emphasis).toFixed(3),
        });
        nodeGroup.append(glow, ring, core, hit);
      } else if (stateClass.includes("is-complete")) {
        const checkSize = Math.max(3.6, node.render.thickness * 0.34) * uiScale;
        const check = createSvgElement("path", {
          d: `M ${(node.render.x - checkSize * 0.55).toFixed(2)} ${node.render.y.toFixed(2)} L ${(node.render.x - checkSize * 0.12).toFixed(2)} ${(node.render.y + checkSize * 0.45).toFixed(2)} L ${(node.render.x + checkSize * 0.6).toFixed(2)} ${(node.render.y - checkSize * 0.45).toFixed(2)}`,
          class: "node-complete-check",
          "stroke-width": (Math.max(1.4, node.render.thickness * 0.16) * uiScale).toFixed(2),
          opacity: emphasis.toFixed(3),
        });
        nodeGroup.append(glow, core, check, hit);
      } else {
        nodeGroup.append(glow, core, hit);
      }
    }

    const globallyDisabled = Boolean(state.animation);

    for (const node of nodes) {
      if (!canExpand(node)) continue;
      if (state.animation && node.id === state.animation.sourceId) continue;

      const anchor = growthBudAnchor(node);
      const emphasis = node.render.emphasis ?? 1;
      const meta = node.metadata || {};
      const needsQuiz = Boolean(meta.question) && meta.status !== "complete";
      const classes = ["tip-button"];
      if (globallyDisabled || node.ui.loading) classes.push("is-disabled");
      if (node.ui.loading) classes.push("is-loading");
      if (node.ui.error) classes.push("is-error");
      if (needsQuiz) classes.push("is-quiz");

      const tipButton = createSvgElement("g", {
        class: classes.join(" "),
        transform: `translate(${anchor.x.toFixed(2)} ${anchor.y.toFixed(2)}) scale(${uiScale.toFixed(3)})`,
        tabindex: globallyDisabled || node.ui.loading ? -1 : 0,
        role: "button",
        "aria-label": needsQuiz ? `Quiz to unlock ${node.label}` : `Expand ${node.label}`,
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

      tipButton.append(glow, ring);

      if (needsQuiz) {
        const questionMark = createSvgElement("text", {
          class: "tip-question",
          x: 0,
          y: 0,
          "text-anchor": "middle",
          "dominant-baseline": "central",
        });
        questionMark.textContent = "?";
        tipButton.append(questionMark);
      } else {
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
        tipButton.append(plusH, plusV);
      }

      if (!globallyDisabled && !node.ui.loading) {
        const triggerExpand = () => state.onExpandRequest(node.id);
        tipButton.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          triggerExpand();
        });
        tipButton.addEventListener("click", (event) => {
          event.preventDefault();
        });
        tipButton.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            triggerExpand();
          }
        });
      }

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

  function getNodeDetails(nodeId) {
    const node = state.nodes.get(nodeId);
    if (!node) return null;

    return {
      id: node.id,
      label: node.label,
      summary: node.summary,
      description: node.description,
      metadata: node.metadata,
      depth: node.depth,
      expandable: node.expandable,
      childCount: realChildren(node).length,
      path: buildPath(nodeId),
    };
  }

  function getNodeContext(nodeId) {
    const node = state.nodes.get(nodeId);
    const root = state.nodes.get(state.rootId);
    const details = getNodeDetails(nodeId);
    if (!node || !root || !details) return null;

    return {
      rootTopic: root.label,
      nodeId: node.id,
      nodeLabel: node.label,
      summary: node.summary,
      description: node.description,
      depth: node.depth,
      expandable: node.expandable,
      path: details.path,
      existingChildren: realChildren(node).map((child) => child.label).filter(Boolean),
    };
  }

  function serializeNode(node) {
    if (!node || isLoadingPlaceholder(node)) return null;
    return {
      id: node.id,
      label: node.label,
      parentId: node.parentId,
      summary: node.summary,
      description: node.description,
      expandable: node.expandable,
      metadata: node.metadata,
    };
  }

  function getSnapshot() {
    if (!state.rootId) return null;

    const root = state.nodes.get(state.rootId);
    const nodes = [...state.nodes.values()]
      .filter((node) => node.id !== state.rootId && !isLoadingPlaceholder(node))
      .map(serializeNode)
      .filter(Boolean);

    return {
      root: serializeNode(root),
      nodes,
    };
  }

  return {
    appendChildren,
    insertParent,
    getNodeContext,
    getSnapshot,
    patchNode,
    setExpandHandler,
    setHoverHandler,
    setNodeSelectHandler,
    setViewportScale,
    setNodeError,
    setNodeLoading,
    setRootLoading,
    setTree,
  };
}
