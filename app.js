import { TreeController } from "./tree-controller.js";
import { ApiTreeProvider, MockTreeProvider } from "./tree-provider.js";
import { createTreeRenderer } from "./tree-renderer.js";

const BUILD_VERSION = "Latest build marker: TREE_OVERLAY_PAN_V1 (2026-04-29)";
const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 720;
const PAN_LIMIT_X = 260;
const PAN_LIMIT_Y_UP = 200;
const PAN_LIMIT_Y_DOWN = 120;

const canvasFrame = document.querySelector("#canvasFrame");
const treeSvg = document.querySelector("#treeSvg");
const treeViewport = document.querySelector("#treeViewport");
const renderer = createTreeRenderer({
  svg: treeSvg,
  branchBackdrop: document.querySelector("#branchBackdrop"),
  branchGroup: document.querySelector("#branchGroup"),
  tipGroup: document.querySelector("#tipGroup"),
  nodeGroup: document.querySelector("#nodeGroup"),
});
const buildBanner = document.querySelector("#buildBanner");
const nodeInfoTitle = document.querySelector("#nodeInfoTitle");
const nodeInfoSummary = document.querySelector("#nodeInfoSummary");
const nodeInfoPath = document.querySelector("#nodeInfoPath");
const nodeInfoDepth = document.querySelector("#nodeInfoDepth");
const nodeInfoChildren = document.querySelector("#nodeInfoChildren");
const nodeInfoExpandable = document.querySelector("#nodeInfoExpandable");
const nodeInfoEmpty = document.querySelector("#nodeInfoEmpty");
const nodeInfoMetadata = document.querySelector("#nodeInfoMetadata");

const panState = {
  x: 0,
  y: 0,
  pointerId: null,
  startClientX: 0,
  startClientY: 0,
  originX: 0,
  originY: 0,
  hasMoved: false,
};

function formatMetadataLabel(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function applyViewportTransform() {
  if (!treeViewport) return;
  treeViewport.setAttribute(
    "transform",
    `translate(${panState.x.toFixed(2)} ${panState.y.toFixed(2)})`,
  );
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

function resetViewportPosition() {
  panState.x = 0;
  panState.y = 0;
  applyViewportTransform();
}

function setPanCursor(isPanning) {
  if (!canvasFrame) return;
  canvasFrame.classList.toggle("is-panning", isPanning);
}

function handlePanPointerDown(event) {
  if (!(event.target instanceof Element)) return;
  if (event.button !== 0) return;
  if (event.target.closest(".tip-button")) return;
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

  panState.x = clamp(panState.originX + delta.x, -PAN_LIMIT_X, PAN_LIMIT_X);
  panState.y = clamp(panState.originY + delta.y, -PAN_LIMIT_Y_UP, PAN_LIMIT_Y_DOWN);
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

  panState.pointerId = null;
  setPanCursor(false);
}

function setupViewportPan() {
  if (!treeSvg) return;

  applyViewportTransform();
  treeSvg.addEventListener("pointerdown", handlePanPointerDown);
  treeSvg.addEventListener("pointermove", handlePanPointerMove);
  treeSvg.addEventListener("pointerup", finishPan);
  treeSvg.addEventListener("pointercancel", finishPan);
}

function renderNodeInfo(node) {
  if (!node) {
    if (nodeInfoTitle) nodeInfoTitle.textContent = "Hover a node";
    if (nodeInfoSummary) {
      nodeInfoSummary.textContent =
        "Move over any topic node to inspect its details from the tree data.";
    }
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

if (buildBanner) {
  buildBanner.textContent = BUILD_VERSION;
}
renderNodeInfo(null);
setupViewportPan();

renderer.setHoverHandler((node) => {
  renderNodeInfo(node);
});

const controller = new TreeController({
  provider: new MockTreeProvider(),
  renderer,
  initialTopic: "Learning Tree",
});

controller.init().catch((error) => {
  console.error("Failed to initialize learning tree", error);
});

// Small debug facade so the backend teammate can drive the tree without
// touching renderer internals while local development is in progress.
window.treeApp = {
  seed(topic) {
    return controller.seed(topic);
  },
  async seedWithApi(topic, options = {}) {
    controller.setProvider(new ApiTreeProvider(options));
    return controller.seed(topic);
  },
  expand(nodeId) {
    return controller.expand(nodeId);
  },
  hydrate(snapshot) {
    controller.hydrate(snapshot);
  },
  getSnapshot() {
    return controller.getSnapshot();
  },
  resetViewport() {
    resetViewportPosition();
  },
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
