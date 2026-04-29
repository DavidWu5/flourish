/**
 * Provider contract:
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
 */
export class TreeProvider {
  async seed(_topic) {
    throw new Error("TreeProvider.seed(topic) must be implemented");
  }

  async expand(_nodeId, _context) {
    throw new Error("TreeProvider.expand(nodeId, context) must be implemented");
  }
}

const STARTER_LIBRARY = {
  "learning tree": [
    ["Foundations", "The essential concepts to understand first."],
    ["Core Concepts", "The main ideas that structure the subject."],
    ["Practice", "Exercises and repetition that build fluency."],
    ["Applications", "Where the topic becomes useful in the real world."],
  ],
  "linear algebra": [
    ["Vectors", "The basic objects that everything else builds on."],
    ["Matrices", "The standard representation for linear systems."],
    ["Linear Transformations", "How algebra and geometry connect."],
    ["Eigenvalues", "A key gateway to advanced applications."],
  ],
  javascript: [
    ["Syntax and Types", "The base language features and primitives."],
    ["Functions", "How behavior is organized and reused."],
    ["Objects and Arrays", "The core data structures of the language."],
    ["Async JavaScript", "Promises, events, and real-world flow control."],
  ],
  calculus: [
    ["Limits", "The conceptual foundation of calculus."],
    ["Derivatives", "How change is measured and reasoned about."],
    ["Integrals", "How accumulation and area are modeled."],
    ["Applications", "Optimization, motion, and modeling."],
  ],
};

const EXPANSION_LIBRARY = {
  foundations: [
    ["Vocabulary", "Important terms to recognize early."],
    ["Mental Models", "The intuition that makes later topics easier."],
    ["Prerequisites", "Concepts worth reviewing before going deeper."],
  ],
  "core concepts": [
    ["Big Picture", "How the central ideas fit together."],
    ["Common Patterns", "Recurring structures across the topic."],
    ["Misconceptions", "Mistakes learners often make here."],
  ],
  practice: [
    ["Guided Exercises", "Low-friction practice with feedback."],
    ["Challenge Problems", "A harder layer that tests understanding."],
    ["Review Loop", "A cycle for reinforcing what was learned."],
  ],
  applications: [
    ["Real-World Examples", "Concrete use cases for the topic."],
    ["Projects", "Hands-on work that applies the ideas."],
    ["Cross-Disciplinary Uses", "Where this topic connects to others."],
  ],
  vectors: [
    ["Vector Operations", "Addition, scaling, and basic manipulation."],
    ["Span and Basis", "How vector spaces are generated and described."],
    ["Subspaces", "Important subsets with preserved structure."],
  ],
  matrices: [
    ["Matrix Operations", "Multiplication, inverses, and arithmetic."],
    ["Systems of Equations", "Where matrices become especially useful."],
    ["Row Reduction", "A practical algorithm for solving systems."],
  ],
  "linear transformations": [
    ["Kernel and Image", "The most important structural outputs."],
    ["Change of Basis", "How coordinates shift across perspectives."],
    ["Geometric Interpretation", "The visual meaning of transformations."],
  ],
  eigenvalues: [
    ["Characteristic Polynomial", "The path to finding eigenvalues."],
    ["Eigenvectors", "The directions preserved by a transformation."],
    ["Diagonalization", "Why eigen-structure is computationally powerful."],
  ],
  "syntax and types": [
    ["Variables", "How values are declared and updated."],
    ["Strings and Numbers", "The most common primitive values."],
    ["Conditionals", "How the program makes decisions."],
  ],
  functions: [
    ["Parameters and Return Values", "The main inputs and outputs."],
    ["Scope", "What data a function can see."],
    ["Higher-Order Functions", "Functions that work with other functions."],
  ],
  "objects and arrays": [
    ["Object Properties", "How structured data is stored."],
    ["Array Methods", "How lists are transformed and queried."],
    ["Nested Data", "How real application data is modeled."],
  ],
  "async javascript": [
    ["Promises", "The base primitive for asynchronous work."],
    ["Async and Await", "The cleaner syntax built on promises."],
    ["Event Loop", "Why JavaScript behaves the way it does."],
  ],
};

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleCaseWords(value) {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function uniqueByLabel(entries, existingLabels) {
  const taken = new Set(existingLabels.map((label) => label.toLowerCase()));
  const results = [];

  for (const [label, summary] of entries) {
    const key = label.toLowerCase();
    if (taken.has(key)) continue;
    taken.add(key);
    results.push([label, summary]);
  }

  return results;
}

function genericStarterTopics(topic) {
  return [
    [`${titleCaseWords(topic)} Foundations`, "The prerequisite ideas to start with."],
    [`${titleCaseWords(topic)} Core Concepts`, "The main concepts that define the topic."],
    [`${titleCaseWords(topic)} Practice`, "A path for building confidence and retention."],
    [`${titleCaseWords(topic)} Applications`, "Where the ideas become useful."],
  ];
}

function genericExpansionTopics(context) {
  return [
    [`${context.nodeLabel}: Basics`, "A first pass at the core ideas in this branch."],
    [`${context.nodeLabel}: Key Examples`, "Concrete examples that make the branch easier to understand."],
    [`${context.nodeLabel}: Common Pitfalls`, "Mistakes to watch for while learning this branch."],
  ];
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
    const key = topic.trim().toLowerCase();
    const starter = STARTER_LIBRARY[key] || genericStarterTopics(topic);
    const rootId = `root-${slugify(topic) || "topic"}`;

    return {
      root: {
        id: rootId,
        label: topic,
        parentId: null,
        summary: `A learning tree for ${topic}.`,
        expandable: false,
      },
      nodes: starter.slice(0, 5).map(([label, summary]) =>
        this.makeNode({
          label,
          parentId: rootId,
          summary,
          expandable: this.maxDepth > 1,
        }),
      ),
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

    const key = context.nodeLabel.trim().toLowerCase();
    const source = EXPANSION_LIBRARY[key] || genericExpansionTopics(context);
    const suggestions = uniqueByLabel(source, context.existingChildren);
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
