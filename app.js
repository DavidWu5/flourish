import { TreeController } from "./tree-controller.js";
import { ApiTreeProvider, MockTreeProvider } from "./tree-provider.js";
import { createTreeRenderer } from "./tree-renderer.js";

const BUILD_VERSION = "Latest build marker: TREE_ONLY_V1 (2026-04-29)";

const renderer = createTreeRenderer({
  svg: document.querySelector("#treeSvg"),
  branchBackdrop: document.querySelector("#branchBackdrop"),
  branchGroup: document.querySelector("#branchGroup"),
  tipGroup: document.querySelector("#tipGroup"),
  nodeGroup: document.querySelector("#nodeGroup"),
});
const buildBanner = document.querySelector("#buildBanner");
if (buildBanner) {
  buildBanner.textContent = BUILD_VERSION;
}

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
