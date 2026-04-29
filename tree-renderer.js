const SVG_NS = "http://www.w3.org/2000/svg";

const WIDTH = 1000;
const HEIGHT = 720;
const ROOT_X = WIDTH / 2;
const ROOT_Y = HEIGHT - 92;
const GROW_DURATION = 1250;

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
    rafId: 0,
    lastNow: performance.now(),
    onExpandRequest: () => {},
  };

  svg.addEventListener("click", (event) => {
    if (event.target === svg) {
      event.preventDefault();
    }
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

  function canExpand(node) {
    return Boolean(node.expandable) && !node.ui.loading;
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
      node.render = { ...node.target, visibility: 1 };
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

    for (const node of state.nodes.values()) {
      node.from = {
        x: node.render.x,
        y: node.render.y,
        angle: node.render.angle,
        thickness: node.render.thickness,
      };
    }

    for (const data of childNodes) {
      if (state.nodes.has(data.id)) continue;
      const child = createVisualNode({ ...data, parentId });
      state.nodes.set(child.id, child);
      parent.children.push(child.id);

      child.from = {
        x: parent.render.x,
        y: parent.render.y,
        angle: parent.render.angle,
        thickness: Math.max(1.4, parent.render.thickness * 0.74),
      };
      child.render = { ...child.from, visibility: 0.0001 };
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
      node.stats = { weight: 1, spread: 0, girth: node.stats.girth };
      return node.stats;
    }

    const childStats = node.children.map((childId) => collectStats(childId));
    const weight = childStats.reduce((sum, item) => sum + item.weight, 0);
    const spread = childStats.reduce((sum, item, index) => {
      const child = state.nodes.get(node.children[index]);
      return sum + item.weight * (child.side || 0);
    }, 0);

    node.stats = { weight, spread, girth: node.stats.girth };
    return node.stats;
  }

  function branchLength(node) {
    if (node.slot === "trunk") return 118;

    const siblingCount = node.parentId ? state.nodes.get(node.parentId).children.length : 1;
    const depthScale = Math.pow(0.81, Math.max(0, node.depth - 2));
    const vigor = 0.95 + Math.min(0.24, node.stats.weight * 0.06);
    const noise = 0.9 + node.seed.length * 0.18;
    const crowdScale = lerp(1.02, 0.78, clamp((siblingCount - 1) / 4, 0, 1));
    const centerlineBoost = 0.92 + (1 - Math.abs(node.side)) * 0.14;
    return 98 * depthScale * vigor * noise * crowdScale * centerlineBoost;
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

    node.stats.girth = Math.max(structuralFloor, combinedFlow);
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

  function nextAngleFor(parent, node, index, siblingCount) {
    if (node.slot === "trunk") {
      return -Math.PI / 2 + node.seed.lean * 0.03;
    }

    const outwardBias = clamp((parent.target.x - ROOT_X) / 330, -1, 1) * 0.12;
    const upBias = clamp(parent.depth / 6, 0, 1);
    const offset = childSpreadOffset(index, siblingCount);
    const fan = childFanSpread(node, siblingCount);
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

    children.forEach((child, index) => {
      const angle = nextAngleFor(node, child, index, siblingCount);
      const length = branchLength(child);
      const position = pointAtAngle(node.target, angle, length);

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
      drawScene(now);

      if (state.animation) {
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
        };
      }
      return;
    }

    const growT = clamp((now - animation.start) / GROW_DURATION, 0, 1);

    for (const node of state.nodes.values()) {
      const isNewChild = animation.newChildIds.has(node.id);
      const mix = isNewChild ? easeInOutCubic(growT) : easeOutSine(clamp(growT * 1.15, 0, 1));

      node.render = {
        x: lerp(node.from.x, node.target.x, mix),
        y: lerp(node.from.y, node.target.y, mix),
        angle: lerpAngle(node.from.angle, node.target.angle, mix),
        thickness: lerp(node.from.thickness, node.target.thickness, mix),
        visibility: isNewChild ? clamp(mix * 1.08, 0, 1) : 1,
      };
    }

    if (now >= animation.end) {
      state.animation = null;
      updateAnimation(now);
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

  function branchGeometry(parent, child) {
    const start = { x: parent.render.x, y: parent.render.y };
    const end = { x: child.render.x, y: child.render.y };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    const straight = { x: dx / length, y: dy / length };
    const curvePerp = perpendicular(straight);
    const dirA = { x: Math.cos(parent.render.angle), y: Math.sin(parent.render.angle) };
    const dirB = { x: Math.cos(child.render.angle), y: Math.sin(child.render.angle) };

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

    const outline = [...left, ...right.reverse()];
    return (
      outline
        .map((point, index) =>
          `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
        )
        .join(" ") + " Z"
    );
  }

  function branchOutlinePath(parent, child, geometry, scale = 1) {
    const startWidth = branchStartWidth(parent, child) * scale * 0.5;
    const endWidth = branchEndWidth(child) * scale * 0.5;
    return outlinePathFromGeometry(
      geometry,
      startWidth,
      endWidth,
      child.slot === "trunk" ? 18 : 14,
    );
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

  function drawRootBase(node) {
    const geometry = rootBaseGeometry(node);
    const startWidth = node.render.thickness * 1.95 * 0.5;
    const endWidth = node.render.thickness * 1.02 * 0.5;
    const shadow = createSvgElement("path", {
      d: outlinePathFromGeometry(geometry, startWidth * 1.16, endWidth * 1.14, 16),
      class: "branch-shadow",
      opacity: 0.92,
    });
    const core = createSvgElement("path", {
      d: outlinePathFromGeometry(geometry, startWidth, endWidth, 16),
      class: "branch-core",
      opacity: 0.98,
    });
    const highlight = createSvgElement("path", {
      d: geometry.centerline,
      class: "branch-highlight",
      "stroke-width": Math.max(1.2, endWidth * 0.32).toFixed(2),
      opacity: 0.26,
    });

    branchBackdrop.append(shadow);
    branchGroup.append(core, highlight);
  }

  function drawScene(now) {
    branchBackdrop.replaceChildren();
    branchGroup.replaceChildren();
    tipGroup.replaceChildren();
    nodeGroup.replaceChildren();

    const nodes = [...state.nodes.values()].sort((a, b) => a.depth - b.depth);
    const root = state.nodes.get(state.rootId);
    if (root) {
      drawRootBase(root);
    }

    for (const node of nodes) {
      if (!node.parentId) continue;
      const parent = state.nodes.get(node.parentId);
      const geometry = branchGeometry(parent, node);
      const shadow = createSvgElement("path", {
        d: branchOutlinePath(parent, node, geometry, 1.16),
        class: "branch-shadow",
        opacity: 0.92,
      });
      const core = createSvgElement("path", {
        d: branchOutlinePath(parent, node, geometry),
        class: "branch-core",
        opacity: 0.98,
      });
      const highlight = createSvgElement("path", {
        d: geometry.centerline,
        class: "branch-highlight",
        "stroke-width": Math.max(0.9, branchEndWidth(node) * 0.22).toFixed(2),
        opacity: clamp(0.2 + node.render.visibility * 0.16, 0.1, 0.32),
      });

      if (node.render.visibility < 1) {
        const alpha = clamp(node.render.visibility, 0, 1);
        shadow.setAttribute("opacity", (0.25 + alpha * 0.67).toFixed(3));
        core.setAttribute("opacity", alpha.toFixed(3));
        highlight.setAttribute("opacity", (alpha * 0.18).toFixed(3));
      }

      branchBackdrop.append(shadow);
      branchGroup.append(core, highlight);
    }

    for (const node of nodes) {
      if (!node.parentId) continue;

      const glow = createSvgElement("circle", {
        cx: node.render.x.toFixed(2),
        cy: node.render.y.toFixed(2),
        r: Math.max(2.2, node.render.thickness * 0.42).toFixed(2),
        class: "node-glow",
        opacity: 0.46,
      });
      const core = createSvgElement("circle", {
        cx: node.render.x.toFixed(2),
        cy: node.render.y.toFixed(2),
        r: Math.max(1.7, node.render.thickness * 0.18).toFixed(2),
        class: "node-core",
      });

      nodeGroup.append(glow, core);

      if (!node.children.length) {
        const bud = createSvgElement("circle", {
          cx: (node.render.x + Math.cos(node.render.angle) * 6).toFixed(2),
          cy: (node.render.y + Math.sin(node.render.angle) * 6).toFixed(2),
          r: 4.7,
          class: "blossom-bud",
          opacity: 0.88,
        });
        nodeGroup.append(bud);
      }
    }

    const globallyDisabled = Boolean(state.animation);

    for (const node of nodes) {
      if (!canExpand(node)) continue;
      if (state.animation && node.id === state.animation.sourceId) continue;

      const anchor = growthBudAnchor(node);
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
      });

      const glow = createSvgElement("circle", {
        class: "tip-glow",
        r: 18,
        opacity: 0.9,
      });
      const ring = createSvgElement("circle", {
        class: "tip-ring",
        r: 11.5,
      });
      const plusH = createSvgElement("line", {
        class: "tip-plus",
        x1: -4.2,
        y1: 0,
        x2: 4.2,
        y2: 0,
      });
      const plusV = createSvgElement("line", {
        class: "tip-plus",
        x1: 0,
        y1: -4.2,
        x2: 0,
        y2: 4.2,
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
  }

  function growthBudAnchor(node) {
    let angle;
    if (!node.parentId) {
      angle = -Math.PI / 2;
    } else {
      const nextCount = node.children.length + 1;
      const nextIndex = node.children.length;
      const offset = childSpreadOffset(nextIndex, nextCount);
      const fan = childFanSpread(node, nextCount);
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
