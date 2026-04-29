import { TreeController } from "./tree-controller.js";
import { ApiTreeProvider, MockTreeProvider } from "./tree-provider.js";
import { createTreeRenderer } from "./tree-renderer.js";
import { setupQuestionFlow } from "./question-flow.js";
import { setupTopicEntry } from "./topic-entry.js";

const BUILD_VERSION = "Latest build marker: TREE_NODE_DETAIL_V1 (2026-04-29)";
const SVG_NS = "http://www.w3.org/2000/svg";
const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 720;
const TREE_ZOOM_ORIGIN_X = VIEWBOX_WIDTH / 2;
const TREE_ZOOM_ORIGIN_Y = 690;
const PAN_LIMIT_X = 260;
const PAN_LIMIT_Y_UP = 200;
const PAN_LIMIT_Y_DOWN = 120;
const DEFAULT_PAN_Y = -42;
const DEFAULT_VIEWPORT_SCALE = 1;
const MIN_VIEWPORT_SCALE = 1;
const MAX_VIEWPORT_SCALE = 2.6;
const ZOOM_STEP_FACTOR = 1.22;
const TREE_FOCUS_OVERFLOW_RATIO = 0.7;
const TREE_FOCUS_PADDING = 24;
const TREE_TOPIC_LABEL_X = VIEWBOX_WIDTH / 2;
const TREE_TOPIC_LABEL_Y = 708;
const TREE_TOPIC_TYPE_SPEED_MS = 44;
const PETAL_PARTICLE_COUNT = 14;
const PETAL_PARTICLE_MOBILE_COUNT = 10;
const PETAL_PARTICLE_SPAWN_MIN_X = 0.18;
const PETAL_PARTICLE_SPAWN_MAX_X = 0.82;
const PETAL_SVG_PATH =
  "M45.124,87.882C42.238,89.849 38.752,91 35,91C25.066,91 17,82.934 17,73C17,63.677 24.104,56 33.189,55.09C28.261,51.877 25,46.317 25,40C25,30.066 33.066,22 43,22C50.371,22 56.714,26.441 59.496,32.79C61.393,24.884 68.515,19 77,19C86.934,19 95,27.066 95,37C95,42.703 92.342,47.79 88.198,51.089C88.791,51.03 89.392,51 90,51C99.934,51 108,59.066 108,69C108,78.934 99.934,87 90,87C86.279,87 82.821,85.869 79.95,83.931C80.63,85.828 81,87.871 81,90C81,99.934 72.934,108 63,108C53.066,108 45,99.934 45,90C45,89.283 45.042,88.577 45.124,87.882Z";

function createIntroTreeSnapshot() {
  return {
    root: {
      id: "intro-root",
      label: "Learning Tree",
      parentId: null,
      summary: "A starter stump waiting for a topic.",
      description:
        "Enter a topic below and this stump will grow into your learning tree.",
      expandable: false,
      metadata: {
        status: "Waiting for topic",
      },
    },
    nodes: [],
  };
}

const canvasFrame = document.querySelector("#canvasFrame");
const treeSvg = document.querySelector("#treeSvg");
const treeViewport = document.querySelector("#treeViewport");
const treeZoomGroup = document.querySelector("#treeZoomGroup");
const treeBaseLabelGroup = document.querySelector("#treeBaseLabelGroup");
const petalParticles = document.querySelector("#petalParticles");
const zoomOutButton = document.querySelector("#zoomOutButton");
const zoomInButton = document.querySelector("#zoomInButton");
const zoomResetButton = document.querySelector("#zoomResetButton");
const renderer = createTreeRenderer({
  svg: treeSvg,
  branchBackdrop: document.querySelector("#branchBackdrop"),
  branchGroup: document.querySelector("#branchGroup"),
  tipGroup: document.querySelector("#tipGroup"),
  nodeGroup: document.querySelector("#nodeGroup"),
});
const buildBanner = document.querySelector("#buildBanner");
const nodeInfoPanel = document.querySelector("#nodeInfoPanel");
const nodeInfoTitle = document.querySelector("#nodeInfoTitle");
const nodeInfoSummary = document.querySelector("#nodeInfoSummary");
const nodeInfoHint = document.querySelector("#nodeInfoHint");
const nodeInfoPath = document.querySelector("#nodeInfoPath");
const nodeInfoDepth = document.querySelector("#nodeInfoDepth");
const nodeInfoChildren = document.querySelector("#nodeInfoChildren");
const nodeInfoExpandable = document.querySelector("#nodeInfoExpandable");
const nodeInfoEmpty = document.querySelector("#nodeInfoEmpty");
const nodeInfoMetadata = document.querySelector("#nodeInfoMetadata");
const nodeDetailLayer = document.querySelector("#nodeDetailLayer");
const nodeDetailTitle = document.querySelector("#nodeDetailTitle");
const nodeDetailPath = document.querySelector("#nodeDetailPath");
const nodeDetailBody = document.querySelector("#nodeDetailBody");
const nodeDetailClose = document.querySelector("#nodeDetailClose");

const panState = {
  x: 0,
  y: DEFAULT_PAN_Y,
  scale: DEFAULT_VIEWPORT_SCALE,
  pointerId: null,
  startClientX: 0,
  startClientY: 0,
  originX: 0,
  originY: 0,
  hasMoved: false,
  lastDragEndedAt: 0,
};

const petalMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const petalParticleState = {
  items: [],
  rafId: 0,
  lastNow: 0,
  reducedMotion: petalMotionQuery.matches,
  width: 0,
  height: 0,
};

let hoveredNode = null;
let topicLabelTimerId = 0;
let petalParticleIdSequence = 0;

function formatMetadataLabel(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function createSvgElement(name, attrs = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function createPetalParticleElement() {
  const gradientId = `petal-particle-gradient-${petalParticleIdSequence++}`;
  const svg = createSvgElement("svg", {
    class: "petal-particle",
    viewBox: "0 0 128 128",
    "aria-hidden": "true",
    focusable: "false",
  });
  const defs = createSvgElement("defs");
  const gradient = createSvgElement("linearGradient", {
    id: gradientId,
    x1: "50%",
    y1: "0%",
    x2: "50%",
    y2: "100%",
  });
  gradient.append(
    createSvgElement("stop", {
      offset: "0%",
      "stop-color": "#ffffff",
      "stop-opacity": "0.98",
    }),
    createSvgElement("stop", {
      offset: "42%",
      "stop-color": "#fcf3f7",
      "stop-opacity": "0.98",
    }),
    createSvgElement("stop", {
      offset: "76%",
      "stop-color": "#f6d6e2",
      "stop-opacity": "0.96",
    }),
    createSvgElement("stop", {
      offset: "100%",
      "stop-color": "#f2bdd0",
      "stop-opacity": "0.92",
    }),
  );
  defs.append(gradient);

  const group = createSvgElement("g", {
    transform: "matrix(1.37363,0,0,1.37363,-21.8516,-23.2253)",
  });
  const path = createSvgElement("path", {
    d: PETAL_SVG_PATH,
    fill: `url(#${gradientId})`,
    class: "petal-particle-shape",
  });

  group.append(path);
  svg.append(defs, group);
  return svg;
}

function clearTopicLabelAnimation() {
  if (topicLabelTimerId) {
    window.clearTimeout(topicLabelTimerId);
    topicLabelTimerId = 0;
  }
}

function topicLabelFontSize(topic) {
  if (topic.length > 28) return 20;
  if (topic.length > 20) return 23;
  if (topic.length > 14) return 26;
  return 30;
}

function animateTreeTopicLabel(topic) {
  const cleanTopic = String(topic ?? "").trim();
  clearTopicLabelAnimation();
  treeBaseLabelGroup?.replaceChildren();

  if (!cleanTopic || !treeBaseLabelGroup) return;

  const text = createSvgElement("text", {
    x: TREE_TOPIC_LABEL_X.toFixed(2),
    y: TREE_TOPIC_LABEL_Y.toFixed(2),
    class: "tree-base-topic",
    "text-anchor": "middle",
  });
  text.style.fontSize = `${topicLabelFontSize(cleanTopic)}px`;
  treeBaseLabelGroup.append(text);

  let index = 0;
  const typeNextCharacter = () => {
    index += 1;
    text.textContent = cleanTopic.slice(0, index);
    if (index < cleanTopic.length) {
      topicLabelTimerId = window.setTimeout(typeNextCharacter, TREE_TOPIC_TYPE_SPEED_MS);
      return;
    }
    topicLabelTimerId = 0;
  };

  typeNextCharacter();
}

function refreshPetalParticleBounds() {
  const width = petalParticles?.clientWidth || canvasFrame?.clientWidth || 0;
  const height = petalParticles?.clientHeight || canvasFrame?.clientHeight || 0;
  petalParticleState.width = width;
  petalParticleState.height = height;
  return { width, height };
}

function targetPetalParticleCount() {
  const width = petalParticleState.width || window.innerWidth;
  return width <= 820 ? PETAL_PARTICLE_MOBILE_COUNT : PETAL_PARTICLE_COUNT;
}

function resetPetalParticle(particle, { stagger = false } = {}) {
  const { width, height } = refreshPetalParticleBounds();
  if (!width || !height) return;

  const size = randomBetween(16, 28);
  particle.size = size;
  particle.baseX = randomBetween(width * PETAL_PARTICLE_SPAWN_MIN_X, width * PETAL_PARTICLE_SPAWN_MAX_X);
  particle.y = stagger
    ? randomBetween(-height * 0.08, height * 0.76)
    : randomBetween(-height * 0.22, -size * 1.4);
  particle.elapsed = randomBetween(0, 4.2);
  particle.fallSpeed = randomBetween(20, 38);
  particle.crossDrift = randomBetween(-7, 7);
  particle.driftAmplitude = randomBetween(8, 22);
  particle.driftFrequency = randomBetween(0.55, 1.18);
  particle.rotationBase = randomBetween(0, 360);
  particle.rotationVelocity = randomBetween(-24, 24);
  particle.turnPhase = randomBetween(0, Math.PI * 2);
  particle.turnSpeed = randomBetween(1.1, 2.05);
  particle.opacityBase = randomBetween(0.24, 0.4);

  particle.element.style.width = `${size.toFixed(2)}px`;
  particle.element.style.height = `${size.toFixed(2)}px`;
}

function ensurePetalParticleCount() {
  if (!petalParticles) return;
  const desiredCount = targetPetalParticleCount();

  while (petalParticleState.items.length < desiredCount) {
    const element = createPetalParticleElement();
    petalParticles.append(element);

    const particle = { element };
    petalParticleState.items.push(particle);
    resetPetalParticle(particle, { stagger: true });
  }

  while (petalParticleState.items.length > desiredCount) {
    const particle = petalParticleState.items.pop();
    particle?.element.remove();
  }
}

function stepPetalParticles(now) {
  if (!petalParticles || petalParticleState.reducedMotion) return;

  if (!petalParticleState.lastNow) {
    petalParticleState.lastNow = now;
  }

  const dt = Math.min((now - petalParticleState.lastNow) / 1000, 0.05);
  petalParticleState.lastNow = now;

  const { width, height } = refreshPetalParticleBounds();
  if (!width || !height) {
    petalParticleState.rafId = window.requestAnimationFrame(stepPetalParticles);
    return;
  }

  for (const particle of petalParticleState.items) {
    particle.elapsed += dt;
    particle.y += particle.fallSpeed * dt;

    const x =
      particle.baseX +
      Math.sin(particle.elapsed * particle.driftFrequency + particle.turnPhase) *
        particle.driftAmplitude +
      particle.crossDrift * particle.elapsed;
    const turnWave = Math.sin(particle.elapsed * particle.turnSpeed + particle.turnPhase);
    const rotation =
      particle.rotationBase +
      particle.rotationVelocity * particle.elapsed +
      turnWave * 20;
    const scaleY = 0.42 + (turnWave * 0.5 + 0.5) * 0.58;
    const scaleX = 0.92 + (1 - scaleY) * 0.26;
    const life = clamp(
      (particle.y + particle.size) / Math.max(height + particle.size * 2, 1),
      0,
      1,
    );
    const fade = Math.sin(Math.PI * life);
    const opacity =
      particle.opacityBase *
      Math.max(0, fade) *
      (0.9 + Math.cos(particle.elapsed * 0.72 + particle.turnPhase) * 0.06);

    particle.element.style.opacity = opacity.toFixed(3);
    particle.element.style.transform =
      `translate3d(${x.toFixed(2)}px, ${particle.y.toFixed(2)}px, 0) ` +
      `rotate(${rotation.toFixed(2)}deg) ` +
      `scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)})`;

    if (
      particle.y > height + particle.size * 1.5 ||
      x < -particle.size * 3 ||
      x > width + particle.size * 3
    ) {
      resetPetalParticle(particle);
    }
  }

  petalParticleState.rafId = window.requestAnimationFrame(stepPetalParticles);
}

function stopPetalParticles() {
  window.cancelAnimationFrame(petalParticleState.rafId);
  petalParticleState.rafId = 0;
  petalParticleState.lastNow = 0;
}

function syncPetalParticleMotion() {
  if (!petalParticles) return;

  petalParticleState.reducedMotion = petalMotionQuery.matches;
  if (petalParticleState.reducedMotion) {
    stopPetalParticles();
    petalParticles.hidden = true;
    return;
  }

  petalParticles.hidden = false;
  refreshPetalParticleBounds();
  ensurePetalParticleCount();

  if (!petalParticleState.rafId) {
    petalParticleState.lastNow = performance.now();
    petalParticleState.rafId = window.requestAnimationFrame(stepPetalParticles);
  }
}

function setupPetalParticles() {
  if (!petalParticles) return;

  syncPetalParticleMotion();
  window.addEventListener("resize", () => {
    refreshPetalParticleBounds();
    ensurePetalParticleCount();
  });

  if (typeof petalMotionQuery.addEventListener === "function") {
    petalMotionQuery.addEventListener("change", syncPetalParticleMotion);
    return;
  }

  petalMotionQuery.addListener(syncPetalParticleMotion);
}

function applyViewportTransform() {
  if (treeViewport) {
    treeViewport.setAttribute(
      "transform",
      `translate(${panState.x.toFixed(2)} ${panState.y.toFixed(2)})`,
    );
  }
  if (treeZoomGroup) {
    treeZoomGroup.setAttribute(
      "transform",
      `translate(${TREE_ZOOM_ORIGIN_X.toFixed(2)} ${TREE_ZOOM_ORIGIN_Y.toFixed(2)}) scale(${panState.scale.toFixed(3)}) translate(${(-TREE_ZOOM_ORIGIN_X).toFixed(2)} ${(-TREE_ZOOM_ORIGIN_Y).toFixed(2)})`,
    );
  }
  renderer.setViewportScale(panState.scale);
  updateZoomControls();
}

function clientDeltaToViewBox(deltaX, deltaY) {
  const rect = treeSvg?.getBoundingClientRect();
  if (!rect?.width || !rect.height) {
    return { x: deltaX, y: deltaY };
  }

  return {
    x: (deltaX / rect.width) * VIEWBOX_WIDTH,
    y: (deltaY / rect.height) * VIEWBOX_HEIGHT,
  };
}

function clientPointToViewBox(clientX, clientY) {
  const rect = treeSvg?.getBoundingClientRect();
  if (!rect?.width || !rect.height) {
    return {
      x: VIEWBOX_WIDTH / 2,
      y: VIEWBOX_HEIGHT / 2,
    };
  }

  return {
    x: ((clientX - rect.left) / rect.width) * VIEWBOX_WIDTH,
    y: ((clientY - rect.top) / rect.height) * VIEWBOX_HEIGHT,
  };
}

function getViewportCenterPoint() {
  const rect = treeSvg?.getBoundingClientRect();
  if (!rect?.width || !rect.height) {
    return {
      x: VIEWBOX_WIDTH / 2,
      y: VIEWBOX_HEIGHT / 2,
    };
  }

  return clientPointToViewBox(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function currentPanLimits(scale = panState.scale) {
  const zoomDelta = Math.max(0, scale - 1);
  return {
    x: PAN_LIMIT_X + VIEWBOX_WIDTH * zoomDelta,
    up: PAN_LIMIT_Y_UP + VIEWBOX_HEIGHT * zoomDelta,
    down: PAN_LIMIT_Y_DOWN + VIEWBOX_HEIGHT * zoomDelta,
  };
}

function clampViewportPan() {
  const limits = currentPanLimits();
  panState.x = clamp(panState.x, -limits.x, limits.x);
  panState.y = clamp(panState.y, -limits.up, limits.down);
}

function viewportScreenToWorld(point) {
  return {
    x:
      TREE_ZOOM_ORIGIN_X +
      (point.x - panState.x - TREE_ZOOM_ORIGIN_X) / panState.scale,
    y:
      TREE_ZOOM_ORIGIN_Y +
      (point.y - panState.y - TREE_ZOOM_ORIGIN_Y) / panState.scale,
  };
}

function updateZoomControls() {
  const zoomPercent = Math.round(panState.scale * 100);
  if (zoomResetButton) {
    zoomResetButton.textContent = `${zoomPercent}%`;
    zoomResetButton.disabled = Math.abs(panState.scale - DEFAULT_VIEWPORT_SCALE) < 0.001;
  }
  if (zoomOutButton) {
    zoomOutButton.disabled = panState.scale <= MIN_VIEWPORT_SCALE + 0.001;
  }
  if (zoomInButton) {
    zoomInButton.disabled = panState.scale >= MAX_VIEWPORT_SCALE - 0.001;
  }
}

function zoomViewport(nextScale, screenPoint = getViewportCenterPoint()) {
  const scale = clamp(nextScale, MIN_VIEWPORT_SCALE, MAX_VIEWPORT_SCALE);
  if (Math.abs(scale - panState.scale) < 0.001) return;

  const worldPoint = viewportScreenToWorld(screenPoint);
  panState.scale = scale;
  panState.x =
    screenPoint.x -
    TREE_ZOOM_ORIGIN_X -
    panState.scale * (worldPoint.x - TREE_ZOOM_ORIGIN_X);
  panState.y =
    screenPoint.y -
    TREE_ZOOM_ORIGIN_Y -
    panState.scale * (worldPoint.y - TREE_ZOOM_ORIGIN_Y);
  clampViewportPan();
  applyViewportTransform();
}

function zoomViewportBy(factor, screenPoint) {
  zoomViewport(panState.scale * factor, screenPoint);
}

function resetViewportPosition() {
  panState.x = 0;
  panState.y = DEFAULT_PAN_Y;
  panState.scale = DEFAULT_VIEWPORT_SCALE;
  applyViewportTransform();
}

function getTreeFocusScrollTop() {
  if (!canvasFrame) return null;

  const frameRect = canvasFrame.getBoundingClientRect();
  const frameTop = window.scrollY + frameRect.top;
  const frameHeight = frameRect.height || canvasFrame.offsetHeight || 0;
  const overflow = Math.max(frameHeight - window.innerHeight, 0);

  return Math.max(
    frameTop + overflow * TREE_FOCUS_OVERFLOW_RATIO - TREE_FOCUS_PADDING,
    0,
  );
}

function focusTreeViewport({ behavior = "auto" } = {}) {
  const top = getTreeFocusScrollTop();
  if (top === null) return;
  window.scrollTo({ top: Math.round(top), behavior });
}

function scheduleTreeViewportFocus(options = {}) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      focusTreeViewport(options);
    });
  });
}

function resolveNodeDescription(node) {
  if (!node) return "";
  if (node.description) return node.description;
  if (typeof node.metadata?.fullDescription === "string" && node.metadata.fullDescription) {
    return node.metadata.fullDescription;
  }
  if (typeof node.metadata?.description === "string" && node.metadata.description) {
    return node.metadata.description;
  }
  return node.summary || "";
}

function setPanCursor(isPanning) {
  if (!canvasFrame) return;
  canvasFrame.classList.toggle("is-panning", isPanning);
}

function isInteractiveTextTarget(target) {
  return Boolean(
    target instanceof HTMLElement &&
      (target.closest("input") ||
        target.closest("textarea") ||
        target.closest("select") ||
        target.closest("button")),
  );
}

function handlePanPointerDown(event) {
  if (!(event.target instanceof Element)) return;
  if (event.button !== 0) return;
  if (event.target.closest(".tip-button")) return;
  if (event.target.closest(".topic-hit")) return;
  if (event.target.closest(".node-info-panel")) return;

  panState.pointerId = event.pointerId;
  panState.startClientX = event.clientX;
  panState.startClientY = event.clientY;
  panState.originX = panState.x;
  panState.originY = panState.y;
  panState.hasMoved = false;

  treeSvg?.setPointerCapture(event.pointerId);
  setPanCursor(true);
}

function handlePanPointerMove(event) {
  if (panState.pointerId !== event.pointerId) return;

  const delta = clientDeltaToViewBox(
    event.clientX - panState.startClientX,
    event.clientY - panState.startClientY,
  );

  if (!panState.hasMoved && Math.hypot(delta.x, delta.y) > 6) {
    panState.hasMoved = true;
  }

  panState.x = panState.originX + delta.x;
  panState.y = panState.originY + delta.y;
  clampViewportPan();
  applyViewportTransform();

  if (panState.hasMoved) {
    event.preventDefault();
  }
}

function finishPan(event) {
  if (panState.pointerId !== event.pointerId) return;

  if (treeSvg?.hasPointerCapture(event.pointerId)) {
    treeSvg.releasePointerCapture(event.pointerId);
  }

  if (panState.hasMoved) {
    panState.lastDragEndedAt = performance.now();
  }

  panState.pointerId = null;
  setPanCursor(false);
}

function handleViewportWheel(event) {
  if (!treeSvg) return;
  if (nodeDetailLayer && !nodeDetailLayer.hidden) return;
  if (isInteractiveTextTarget(event.target)) return;

  event.preventDefault();
  const zoomFactor = Math.exp(-event.deltaY * 0.0014);
  const point = clientPointToViewBox(event.clientX, event.clientY);
  zoomViewport(panState.scale * zoomFactor, point);
}

function setupViewportPan() {
  if (!treeSvg) return;

  applyViewportTransform();
  treeSvg.addEventListener("pointerdown", handlePanPointerDown);
  treeSvg.addEventListener("pointermove", handlePanPointerMove);
  treeSvg.addEventListener("pointerup", finishPan);
  treeSvg.addEventListener("pointercancel", finishPan);
  treeSvg.addEventListener("wheel", handleViewportWheel, { passive: false });
}

function setupViewportZoomControls() {
  zoomOutButton?.addEventListener("click", () => {
    zoomViewportBy(1 / ZOOM_STEP_FACTOR);
  });

  zoomInButton?.addEventListener("click", () => {
    zoomViewportBy(ZOOM_STEP_FACTOR);
  });

  zoomResetButton?.addEventListener("click", () => {
    resetViewportPosition();
  });

  window.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    if (isInteractiveTextTarget(event.target)) return;

    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomViewportBy(ZOOM_STEP_FACTOR);
      return;
    }

    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomViewportBy(1 / ZOOM_STEP_FACTOR);
      return;
    }

    if (event.key === "0") {
      event.preventDefault();
      resetViewportPosition();
    }
  });
}

function renderNodeInfo(node) {
  hoveredNode = node;

  if (!node) {
    if (nodeInfoTitle) nodeInfoTitle.textContent = "Hover a node";
    if (nodeInfoSummary) {
      nodeInfoSummary.textContent =
        "Move over any topic node to inspect its details from the tree data.";
    }
    if (nodeInfoHint) nodeInfoHint.textContent = "Press Space to view the full description.";
    if (nodeInfoPath) nodeInfoPath.textContent = "No node selected";
    if (nodeInfoDepth) nodeInfoDepth.textContent = "--";
    if (nodeInfoChildren) nodeInfoChildren.textContent = "--";
    if (nodeInfoExpandable) nodeInfoExpandable.textContent = "--";
    if (nodeInfoEmpty) nodeInfoEmpty.hidden = false;
    if (nodeInfoMetadata) nodeInfoMetadata.replaceChildren();
    return;
  }

  if (nodeInfoTitle) nodeInfoTitle.textContent = node.label || "Untitled topic";
  if (nodeInfoSummary) {
    nodeInfoSummary.textContent =
      node.summary || "No summary was returned for this node yet.";
  }
  if (nodeInfoHint) {
    nodeInfoHint.textContent = "Press Space to view the full description.";
  }
  if (nodeInfoPath) nodeInfoPath.textContent = node.path.join(" / ");
  if (nodeInfoDepth) nodeInfoDepth.textContent = String(node.depth);
  if (nodeInfoChildren) nodeInfoChildren.textContent = String(node.childCount);
  if (nodeInfoExpandable) nodeInfoExpandable.textContent = node.expandable ? "Yes" : "No";

  const metadataEntries = Object.entries(node.metadata || {}).filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );

  if (nodeInfoMetadata) {
    nodeInfoMetadata.replaceChildren();
    metadataEntries.forEach(([key, value]) => {
      const row = document.createElement("div");
      row.className = "node-info-row";

      const term = document.createElement("dt");
      term.textContent = formatMetadataLabel(key);

      const description = document.createElement("dd");
      description.textContent =
        typeof value === "object" ? JSON.stringify(value) : String(value);

      row.append(term, description);
      nodeInfoMetadata.append(row);
    });
  }

  if (nodeInfoEmpty) {
    nodeInfoEmpty.hidden = metadataEntries.length > 0;
  }
}

function snapshotHasActiveTopic(snapshot) {
  const root = snapshot?.root;
  if (!root) return false;
  if (root.id === "intro-root") return false;
  if (String(root.metadata?.status || "").trim().toLowerCase() === "waiting for topic") {
    return false;
  }
  return true;
}

function syncNodeInfoPanelVisibility(snapshot) {
  if (!nodeInfoPanel) return;
  const isVisible = snapshotHasActiveTopic(snapshot);
  nodeInfoPanel.hidden = !isVisible;
  if (!isVisible) {
    renderNodeInfo(null);
  }
}

function closeNodeDetail() {
  if (!nodeDetailLayer) return;
  nodeDetailLayer.hidden = true;
}

function openNodeDetail(node) {
  if (!node || !nodeDetailLayer) return;

  if (nodeDetailTitle) {
    nodeDetailTitle.textContent = node.label || "Untitled topic";
  }
  if (nodeDetailPath) {
    nodeDetailPath.textContent = node.path.join(" / ");
  }
  if (nodeDetailBody) {
    nodeDetailBody.textContent =
      resolveNodeDescription(node) ||
      "No full description was returned for this node yet.";
  }

  nodeDetailLayer.hidden = false;
}

function setupNodeDetailPanel() {
  if (!nodeDetailLayer) return;

  nodeDetailClose?.addEventListener("click", () => {
    closeNodeDetail();
  });

  nodeDetailLayer.addEventListener("click", (event) => {
    if (event.target === nodeDetailLayer) {
      closeNodeDetail();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !nodeDetailLayer.hidden) {
      closeNodeDetail();
    }
  });
}

function setupSpacebarDetailShortcut() {
  window.addEventListener("keydown", (event) => {
    if (event.key !== " ") return;
    if (!hoveredNode) return;
    if (event.repeat) return;
    if (
      event.target instanceof HTMLElement &&
      (event.target.closest("button") ||
        event.target.closest("input") ||
        event.target.closest("textarea") ||
        event.target.closest("select"))
    ) {
      return;
    }

    event.preventDefault();
    openNodeDetail(hoveredNode);
  });
}

function setupInitialTreeFocus() {
  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }

  const focusOptions = { behavior: "auto" };
  const focusWhenVisible = () => {
    scheduleTreeViewportFocus(focusOptions);
  };

  if (document.readyState === "complete") {
    focusWhenVisible();
    return;
  }

  window.addEventListener("load", () => {
    focusWhenVisible();
  }, { once: true });
}

if (buildBanner) {
  buildBanner.textContent = BUILD_VERSION;
}
renderNodeInfo(null);
setupViewportPan();
setupViewportZoomControls();
setupPetalParticles();
setupNodeDetailPanel();
setupSpacebarDetailShortcut();
setupInitialTreeFocus();

renderer.setHoverHandler((node) => {
  renderNodeInfo(node);
});

const controller = new TreeController({
  provider: new ApiTreeProvider(),
  renderer,
  initialTopic: "Learning Tree",
});

controller.hydrate(createIntroTreeSnapshot());
syncNodeInfoPanelVisibility(controller.getSnapshot());

const topicEntry = setupTopicEntry({
  controller,
  resetViewport: resetViewportPosition,
  focusTree: scheduleTreeViewportFocus,
  animateTreeTopic: animateTreeTopicLabel,
  onTopicSeeded: (snapshot) => {
    syncNodeInfoPanelVisibility(snapshot);
  },
});

const questionFlow = setupQuestionFlow({
  controller,
  renderer,
});

// Small debug facade so the backend teammate can drive the tree without
// touching renderer internals while local development is in progress.
window.treeApp = {
  seed(topic) {
    return controller.seed(topic).then((snapshot) => {
      syncNodeInfoPanelVisibility(snapshot);
      return snapshot;
    });
  },
  async seedWithApi(topic, options = {}) {
    controller.setProvider(new ApiTreeProvider(options));
    const snapshot = await controller.seed(topic);
    syncNodeInfoPanelVisibility(snapshot);
    return snapshot;
  },
  expand(nodeId) {
    return controller.expand(nodeId);
  },
  hydrate(snapshot) {
    controller.hydrate(snapshot);
    syncNodeInfoPanelVisibility(controller.getSnapshot());
  },
  getSnapshot() {
    return controller.getSnapshot();
  },
  resetViewport() {
    resetViewportPosition();
  },
  focusTree(options) {
    scheduleTreeViewportFocus(options);
  },
  showTopicModal() {
    topicEntry.open();
  },
  questionFlow,
  useMockProvider() {
    controller.setProvider(new MockTreeProvider());
  },
  useApiProvider(options) {
    controller.setProvider(new ApiTreeProvider(options));
  },
};

// Example:
// await window.treeApp.seedWithApi("Linear Algebra", {
//   seedUrl: "/api/tree/seed",
//   expandUrl: "/api/tree/expand",
// });
