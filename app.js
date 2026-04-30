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
const DEFAULT_PAN_Y = -58;
const DEFAULT_VIEWPORT_SCALE = 1;
const MIN_VIEWPORT_SCALE = 1;
const MAX_VIEWPORT_SCALE = 2.6;
const ZOOM_STEP_FACTOR = 1.22;
const TREE_FOCUS_OVERFLOW_RATIO = 0.7;
const TREE_FOCUS_PADDING = 24;
const TREE_TOPIC_LABEL_X = VIEWBOX_WIDTH / 2;
const TREE_TOPIC_LABEL_Y = 700;
const TREE_TOPIC_TYPE_SPEED_MS = 44;
const PETAL_PARTICLE_COUNT = 30;
const PETAL_PARTICLE_MOBILE_COUNT = 20;
const PETAL_PARTICLE_SPAWN_MIN_X = 0.14;
const PETAL_PARTICLE_SPAWN_MAX_X = 0.86;
const PETAL_PARTICLE_GROUND_Y = 688;
const PETAL_PARTICLE_REST_DURATION_S = 1.08;
const PETAL_PARTICLE_REST_FADE_START_S = 0.8;
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
const nodeDetailLayer = document.querySelector("#nodeDetailLayer");
const nodeDetailTitle = document.querySelector("#nodeDetailTitle");
const nodeDetailPath = document.querySelector("#nodeDetailPath");
const nodeDetailBody = document.querySelector("#nodeDetailBody");
const nodeDetailClose = document.querySelector("#nodeDetailClose");
const nodeDetailCta = document.querySelector("#nodeDetailCta");
const nodeDetailExplain = document.querySelector("#nodeDetailExplain");
const nodeDetailStatus = document.querySelector("#nodeDetailStatus");
const nodeDetailInsights = document.querySelector("#nodeDetailInsights");
const discoveryToast = document.querySelector("#discoveryToast");

let discoveryToastTimer = null;
function showDiscoveryToast(prereqNode) {
  if (!discoveryToast) return;
  const label = prereqNode?.label || "a stepping stone";
  discoveryToast.textContent = `Found a stepping stone — let's build up "${label}" first.`;
  discoveryToast.hidden = false;
  // Force reflow so the animation restarts even on consecutive triggers
  void discoveryToast.offsetWidth;
  discoveryToast.classList.remove("is-visible");
  void discoveryToast.offsetWidth;
  discoveryToast.classList.add("is-visible");

  if (discoveryToastTimer) clearTimeout(discoveryToastTimer);
  discoveryToastTimer = setTimeout(() => {
    discoveryToast.classList.remove("is-visible");
    setTimeout(() => {
      if (!discoveryToast.classList.contains("is-visible")) {
        discoveryToast.hidden = true;
      }
    }, 320);
  }, 3400);
}

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
let activeDetailNode = null;
let topicLabelTimerId = 0;
let petalParticleIdSequence = 0;

const detailInsightCache = new Map();
const detailActionState = {
  questionBusy: false,
  explainBusy: false,
};

const EXPLAIN_LENSES = [
  {
    id: "intuition",
    buttonLabel: "Explain more",
    status: "Finding a calmer, clearer way into this idea...",
  },
  {
    id: "analogy",
    buttonLabel: "Show another angle",
    status: "Looking for an analogy that makes this branch feel familiar...",
  },
  {
    id: "example",
    buttonLabel: "Show another angle",
    status: "Building a tiny example you can hold onto...",
  },
  {
    id: "big-picture",
    buttonLabel: "Show another angle",
    status: "Connecting this branch back to the bigger tree...",
  },
];

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
  const width = VIEWBOX_WIDTH;
  const height = VIEWBOX_HEIGHT;
  petalParticleState.width = width;
  petalParticleState.height = height;
  return { width, height };
}

function targetPetalParticleCount() {
  const width = treeSvg?.clientWidth || canvasFrame?.clientWidth || window.innerWidth;
  return width <= 820 ? PETAL_PARTICLE_MOBILE_COUNT : PETAL_PARTICLE_COUNT;
}

function resetPetalParticle(particle, { stagger = false } = {}) {
  const { width, height } = refreshPetalParticleBounds();
  if (!width || !height) return;

  const size = randomBetween(20, 36);
  particle.size = size;
  particle.baseX = randomBetween(width * PETAL_PARTICLE_SPAWN_MIN_X, width * PETAL_PARTICLE_SPAWN_MAX_X);
  particle.groundY = PETAL_PARTICLE_GROUND_Y - randomBetween(-2, 8);
  particle.y = stagger
    ? randomBetween(-height * 0.08, height * 0.72)
    : randomBetween(-height * 0.24, -size * 1.6);
  particle.elapsed = randomBetween(0, 4.2);
  particle.landed = false;
  particle.landedElapsed = 0;
  particle.landedX = 0;
  particle.landedRotation = 0;
  particle.landedScaleX = 1;
  particle.landedScaleY = 1;
  particle.fallSpeed = randomBetween(24, 46);
  particle.crossDrift = randomBetween(-9, 9);
  particle.driftAmplitude = randomBetween(10, 28);
  particle.driftFrequency = randomBetween(0.52, 1.16);
  particle.rotationBase = randomBetween(0, 360);
  particle.rotationVelocity = randomBetween(-28, 28);
  particle.turnPhase = randomBetween(0, Math.PI * 2);
  particle.turnSpeed = randomBetween(1.08, 1.98);
  particle.opacityBase = randomBetween(0.44, 0.72);

  particle.element.setAttribute("width", size.toFixed(2));
  particle.element.setAttribute("height", size.toFixed(2));
  particle.element.setAttribute("opacity", "0");
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

function setPetalParticleTransform(particle, x, y, rotation, scaleX, scaleY) {
  const center = particle.size * 0.5;
  particle.element.setAttribute(
    "transform",
    `translate(${x.toFixed(2)} ${y.toFixed(2)}) translate(${center.toFixed(2)} ${center.toFixed(2)}) rotate(${rotation.toFixed(2)}) scale(${scaleX.toFixed(3)} ${scaleY.toFixed(3)}) translate(${(-center).toFixed(2)} ${(-center).toFixed(2)})`,
  );
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

    if (particle.landed) {
      particle.landedElapsed += dt;
      const fadeOut =
        particle.landedElapsed <= PETAL_PARTICLE_REST_FADE_START_S
          ? 1
          : clamp(
              1 -
                (particle.landedElapsed - PETAL_PARTICLE_REST_FADE_START_S) /
                  Math.max(PETAL_PARTICLE_REST_DURATION_S - PETAL_PARTICLE_REST_FADE_START_S, 0.001),
              0,
              1,
            );

      particle.element.setAttribute(
        "opacity",
        clamp(particle.opacityBase * 1.06 * fadeOut, 0, 1).toFixed(3),
      );
      setPetalParticleTransform(
        particle,
        particle.landedX,
        particle.y,
        particle.landedRotation,
        particle.landedScaleX,
        particle.landedScaleY,
      );

      if (particle.landedElapsed >= PETAL_PARTICLE_REST_DURATION_S) {
        resetPetalParticle(particle);
      }
      continue;
    }

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
      (0.98 + Math.cos(particle.elapsed * 0.72 + particle.turnPhase) * 0.08);

    if (particle.y + particle.size >= particle.groundY) {
      particle.y = particle.groundY - particle.size;
      particle.landed = true;
      particle.landedElapsed = 0;
      particle.landedX = x;
      particle.landedRotation = rotation + randomBetween(-10, 10);
      particle.landedScaleX = randomBetween(1.02, 1.14);
      particle.landedScaleY = randomBetween(0.7, 0.84);
      particle.element.setAttribute(
        "opacity",
        clamp(particle.opacityBase * 1.08, 0, 1).toFixed(3),
      );
      setPetalParticleTransform(
        particle,
        particle.landedX,
        particle.y,
        particle.landedRotation,
        particle.landedScaleX,
        particle.landedScaleY,
      );
      continue;
    }

    particle.element.setAttribute("opacity", clamp(opacity, 0, 1).toFixed(3));
    setPetalParticleTransform(particle, x, particle.y, rotation, scaleX, scaleY);

    if (
      x < -particle.size * 3 ||
      x > width + particle.size * 3 ||
      particle.y > height + particle.size * 1.5
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
    if (nodeInfoSummary) nodeInfoSummary.textContent = "Move over any branch to explore the concept.";
    return;
  }

  if (nodeInfoTitle) nodeInfoTitle.textContent = node.label || "Untitled topic";
  if (nodeInfoSummary) {
    nodeInfoSummary.textContent = node.summary || "Hover any branch to explore the concept.";
  }
}

function getTopicLabel() {
  return controller.getSnapshot()?.root?.label || controller.initialTopic || "Learning Tree";
}

function createNodeDetailApi() {
  return {
    async explain(payload) {
      const response = await globalThis.fetch("/api/node/explain", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Explain failed: ${response.status} ${response.statusText}`);
      }

      return response.json();
    },
  };
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
  activeDetailNode = null;
  setNodeDetailStatus("", "info");
}

function setNodeDetailStatus(message = "", tone = "info") {
  if (!nodeDetailStatus) return;
  const text = String(message || "").trim();
  nodeDetailStatus.hidden = !text;
  nodeDetailStatus.dataset.tone = text ? tone : "";
  nodeDetailStatus.textContent = text;
}

function createInsightCard(title, body, tone = "support", step) {
  const card = document.createElement("article");
  card.className = "node-detail-insight-card";
  card.dataset.tone = tone;

  const header = document.createElement("div");
  header.className = "node-detail-insight-card-header";

  if (step != null) {
    const badge = document.createElement("span");
    badge.className = "node-detail-insight-step";
    badge.textContent = step;
    header.append(badge);
  }

  const heading = document.createElement("h3");
  heading.className = "node-detail-insight-card-title";
  heading.textContent = title;
  header.append(heading);

  const content = document.createElement("p");
  content.className = "node-detail-insight-body";
  content.textContent = body;

  card.append(header, content);
  return card;
}

function renderNodeDetailInsights(node) {
  if (!nodeDetailInsights) return;

  const cached = node ? detailInsightCache.get(node.id) : null;
  if (!cached?.response) {
    nodeDetailInsights.hidden = true;
    nodeDetailInsights.replaceChildren();
    return;
  }

  const intro = document.createElement("article");
  intro.className = "node-detail-insight-intro";

  const kicker = document.createElement("p");
  kicker.className = "node-detail-insight-kicker";
  kicker.textContent = cached.response.perspective_label || "A gentler way in";

  const title = document.createElement("h3");
  title.className = "node-detail-insight-title";
  title.textContent = cached.response.spark_title || "Here’s the shape of it";

  const body = document.createElement("p");
  body.className = "node-detail-insight-body";
  body.textContent = cached.response.gentle_explanation || "";

  intro.append(kicker, title, body);

  const grid = document.createElement("div");
  grid.className = "node-detail-insight-grid";
  grid.append(
    createInsightCard("Think of it like this", cached.response.analogy, "analogy", 1),
    createInsightCard("Tiny example", cached.response.micro_example, "example", 2),
    createInsightCard("Why this branch matters", cached.response.why_it_matters, "support", 3),
    createInsightCard("Try this next", cached.response.next_step_prompt, "support", 4),
  );

  if (cached.response.encouragement) {
    const nudge = document.createElement("p");
    nudge.className = "node-detail-insight-nudge";
    nudge.textContent = cached.response.encouragement;
    grid.append(nudge);
  }

  nodeDetailInsights.hidden = false;
  nodeDetailInsights.replaceChildren(intro, grid);
}

function updateNodeDetailActionLabels(node = activeDetailNode) {
  if (nodeDetailCta) {
    nodeDetailCta.textContent = node?.metadata?.question
      ? "Test your understanding"
      : "Turn this into a question";
  }

  if (nodeDetailExplain) {
    const explainCount = node ? detailInsightCache.get(node.id)?.count || 0 : 0;
    nodeDetailExplain.textContent =
      explainCount > 0 ? "Show another angle" : "Explain more";
  }
}

function syncNodeDetailActionState() {
  const isBusy = detailActionState.questionBusy || detailActionState.explainBusy;
  if (nodeDetailCta) nodeDetailCta.disabled = isBusy;
  if (nodeDetailExplain) nodeDetailExplain.disabled = isBusy;
  if (nodeDetailClose) nodeDetailClose.disabled = isBusy;
}

function openNodeDetail(node) {
  if (!node || !nodeDetailLayer) return;
  activeDetailNode = node;

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
  if (nodeDetailCta) {
    nodeDetailCta.hidden = false;
  }
  if (nodeDetailExplain) {
    nodeDetailExplain.hidden = !Boolean(resolveNodeDescription(node) || node.summary);
  }

  setNodeDetailStatus("", "info");
  renderNodeDetailInsights(node);
  updateNodeDetailActionLabels(node);
  syncNodeDetailActionState();
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

async function explainActiveNode() {
  const node = activeDetailNode;
  if (!node) return;

  const explainCount = detailInsightCache.get(node.id)?.count || 0;
  const lens = EXPLAIN_LENSES[explainCount % EXPLAIN_LENSES.length];
  detailActionState.explainBusy = true;
  syncNodeDetailActionState();
  setNodeDetailStatus(lens.status, "info");

  try {
    const response = await createNodeDetailApi().explain({
      topic: getTopicLabel(),
      nodeId: node.id,
      nodeLabel: node.label,
      summary: node.summary,
      description: resolveNodeDescription(node),
      path: node.path,
      lens: lens.id,
      lastUnderstandingLevel: node.metadata?.lastUnderstandingLevel || "",
      lastFeedbackMessage: node.metadata?.lastFeedbackMessage || "",
      lastMisconception: node.metadata?.lastMisconception || "",
      missingPrerequisite: node.metadata?.lastMissingPrerequisite || "",
    });

    detailInsightCache.set(node.id, {
      count: explainCount + 1,
      response,
    });

    if (activeDetailNode?.id === node.id) {
      renderNodeDetailInsights(activeDetailNode);
      updateNodeDetailActionLabels(activeDetailNode);
      setNodeDetailStatus(response.encouragement || "You can keep exploring this branch from a few different angles.", "success");
    }
  } catch (error) {
    console.error("Explain more failed", error);
    setNodeDetailStatus(
      error instanceof Error && error.message
        ? error.message
        : "Something went wrong while building a clearer explanation.",
      "error",
    );
  } finally {
    detailActionState.explainBusy = false;
    syncNodeDetailActionState();
  }
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
  setInitialGrowthLoading: (loading) => {
    renderer.setRootLoading(loading);
  },
  onTopicSeeded: (snapshot) => {
    syncNodeInfoPanelVisibility(snapshot);
  },
});

const questionFlow = setupQuestionFlow({
  controller,
  renderer,
  onPrerequisiteInserted: (prereqNode) => {
    showDiscoveryToast(prereqNode);
    openNodeDetail(prereqNode);
  },
  onNodeClick: (node) => {
    openNodeDetail(node);
  },
});

if (nodeDetailCta) {
  nodeDetailCta.addEventListener("click", async () => {
    if (activeDetailNode) {
      const detailNode = activeDetailNode;
      detailActionState.questionBusy = true;
      syncNodeDetailActionState();
      setNodeDetailStatus(
        detailNode.metadata?.question
          ? "Opening a quick check-in question for this branch..."
          : "Turning this branch into a question that checks understanding, not memorization...",
        "info",
      );

      try {
        const result = await questionFlow.openQuestion(detailNode);
        if (result?.opened) {
          closeNodeDetail();
          return;
        }

        if (result?.message) {
          setNodeDetailStatus(
            result.message,
            result.reason === "error" ? "error" : "info",
          );
        }
      } finally {
        detailActionState.questionBusy = false;
        syncNodeDetailActionState();
      }
    }
  });
}

if (nodeDetailExplain) {
  nodeDetailExplain.addEventListener("click", () => {
    void explainActiveNode();
  });
}

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
