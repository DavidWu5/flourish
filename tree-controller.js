export class TreeController {
  constructor({ provider, renderer, initialTopic = "Learning Tree" }) {
    this.provider = provider;
    this.renderer = renderer;
    this.initialTopic = initialTopic;
    this.pendingExpansions = new Set();
    this.prefetchCache = new Map();
    this.expandGate = null;

    this.renderer.setExpandHandler((nodeId) => {
      if (typeof this.expandGate === "function" && !this.expandGate(nodeId)) return;
      void this.expand(nodeId);
    });
  }

  setExpandGate(fn) {
    this.expandGate = fn;
  }

  setProvider(provider) {
    this.provider = provider;
  }

  async init() {
    return this.seed(this.initialTopic);
  }

  async seed(topic = this.initialTopic) {
    this.initialTopic = topic;
    const snapshot = await this.provider.seed(topic);
    this.renderer.setTree(snapshot);
    return snapshot;
  }

  prefetchExpand(nodeId) {
    if (this.prefetchCache.has(nodeId) || this.pendingExpansions.has(nodeId)) return;
    const currentContext = this.renderer.getNodeContext(nodeId);
    if (!currentContext?.expandable || currentContext.existingChildren.length) return;
    this.prefetchCache.set(nodeId, this.provider.expand(nodeId, currentContext).catch(() => null));
  }

  async expand(nodeId) {
    if (this.pendingExpansions.has(nodeId)) return null;

    const currentContext = this.renderer.getNodeContext(nodeId);
    if (!currentContext?.expandable || currentContext.existingChildren.length) {
      return null;
    }

    this.pendingExpansions.add(nodeId);
    this.renderer.setNodeLoading(nodeId, true);
    this.renderer.setNodeError(nodeId, null);

    try {
      const cached = this.prefetchCache.get(nodeId);
      this.prefetchCache.delete(nodeId);
      const response = cached ? await cached : await this.provider.expand(nodeId, currentContext);
      const targetId = response.parentId || nodeId;

      if (response.parentPatch) {
        this.renderer.patchNode(targetId, response.parentPatch);
      }

      const nodes = response.nodes || [];
      this.renderer.patchNode(targetId, { expandable: false });

      this.renderer.appendChildren(targetId, nodes);
      return response;
    } catch (error) {
      console.error(`Failed to expand node ${nodeId}`, error);
      this.renderer.setNodeError(nodeId, error);
      throw error;
    } finally {
      this.pendingExpansions.delete(nodeId);
      this.renderer.setNodeLoading(nodeId, false);
    }
  }

  hydrate(snapshot) {
    this.renderer.setTree(snapshot);
  }

  getSnapshot() {
    return this.renderer.getSnapshot();
  }
}
