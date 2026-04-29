export class TreeController {
  constructor({ provider, renderer, initialTopic = "Learning Tree" }) {
    this.provider = provider;
    this.renderer = renderer;
    this.initialTopic = initialTopic;
    this.pendingExpansions = new Set();

    this.renderer.setExpandHandler((nodeId) => {
      void this.expand(nodeId);
    });
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

  async expand(nodeId) {
    if (this.pendingExpansions.has(nodeId)) return null;

    this.pendingExpansions.add(nodeId);
    this.renderer.setNodeLoading(nodeId, true);
    this.renderer.setNodeError(nodeId, null);

    try {
      const context = this.renderer.getNodeContext(nodeId);
      const response = await this.provider.expand(nodeId, context);
      const targetId = response.parentId || nodeId;

      if (response.parentPatch) {
        this.renderer.patchNode(targetId, response.parentPatch);
      }

      const nodes = response.nodes || [];
      if (!nodes.length) {
        this.renderer.patchNode(targetId, { expandable: false });
      }

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
