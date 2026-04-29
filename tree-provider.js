/**
 * Provider contract:
 *
 * Usage:
 * - Implement `seed(topic)` to return the root node.
 * - Implement `expand(nodeId, context)` to return the next child nodes for a branch.
 *
 * Example:
 * const provider = new ApiTreeProvider({
 *   seedUrl: "/api/tree/seed",
 *   expandUrl: "/api/tree/expand",
 * });
 *
 * seed(topic) => {
 *   root: { id, label, parentId: null, summary?, expandable?, metadata? },
 *   nodes: [{ id, label, parentId, summary?, expandable?, metadata? }]
 * }
 *
 * expand(nodeId, context) => {
 *   parentId: nodeId,
 *   parentPatch?: { expandable?, summary?, metadata? },
 *   nodes: [{ id, label, parentId, summary?, expandable?, metadata? }]
 * }
 *
 * Notes:
 * - `label` is the node topic shown on hover in the frontend.
 * - `summary` is optional supporting text the frontend can surface later.
 */
export class TreeProvider {
  async seed(_topic) {
    throw new Error("TreeProvider.seed(topic) must be implemented");
  }

  async expand(_nodeId, _context) {
    throw new Error("TreeProvider.expand(nodeId, context) must be implemented");
  }
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mockSuggestions(context, count = 3) {
  const baseLabel = context.depth === 0 ? context.rootTopic : context.nodeLabel;
  const existing = new Set(
    context.existingChildren.map((label) => String(label).trim().toLowerCase()),
  );
  const suggestions = [];

  for (let index = 1; suggestions.length < count; index += 1) {
    const label =
      context.depth === 0
        ? `${baseLabel} Branch ${index}`
        : `${baseLabel} Subtopic ${index}`;
    const key = label.trim().toLowerCase();
    if (existing.has(key)) continue;
    existing.add(key);

    suggestions.push([
      label,
      context.depth === 0
        ? `Placeholder starter branch ${index} for ${context.rootTopic}.`
        : `Placeholder child branch ${index} under ${context.nodeLabel}.`,
    ]);
  }

  return suggestions;
}

export class MockTreeProvider extends TreeProvider {
  constructor({ maxDepth = 4 } = {}) {
    super();
    this.maxDepth = maxDepth;
    this.nextId = 0;
  }

  makeNode({ label, parentId, summary, expandable = true }) {
    return {
      id: `topic-${this.nextId++}`,
      label,
      parentId,
      summary,
      expandable,
    };
  }

  async seed(topic) {
    const rootId = `root-${slugify(topic) || "topic"}`;

    return {
      root: {
        id: rootId,
        label: topic,
        parentId: null,
        summary: `A learning tree for ${topic}.`,
        expandable: true,
      },
      nodes: [],
    };
  }

  async expand(nodeId, context) {
    if (context.depth >= this.maxDepth) {
      return {
        parentId: nodeId,
        parentPatch: { expandable: false },
        nodes: [],
      };
    }

    const suggestions = mockSuggestions(context, 3);
    const nextDepth = context.depth + 1;

    return {
      parentId: nodeId,
      parentPatch: { expandable: nextDepth < this.maxDepth },
      nodes: suggestions.slice(0, 3).map(([label, summary]) =>
        this.makeNode({
          label,
          parentId: nodeId,
          summary,
          expandable: nextDepth < this.maxDepth,
        }),
      ),
    };
  }
}

export class ApiTreeProvider extends TreeProvider {
  constructor({
    seedUrl = "/api/tree/seed",
    expandUrl = "/api/tree/expand",
    fetchImpl = globalThis.fetch,
  } = {}) {
    super();
    this.seedUrl = seedUrl;
    this.expandUrl = expandUrl;
    this.fetchImpl = fetchImpl;
  }

  async postJson(url, payload) {
    if (typeof this.fetchImpl !== "function") {
      throw new Error("No fetch implementation available for ApiTreeProvider");
    }

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async seed(topic) {
    return this.postJson(this.seedUrl, { topic });
  }

  async expand(nodeId, context) {
    return this.postJson(this.expandUrl, { nodeId, context });
  }
}
