import { generateStructuredJson, generateText } from './client.js';
import { MODEL_FLASH, MODEL_PRO, groundedConfig, structuredConfig } from './models.js';

const STOP_WORDS = new Set([
  'about',
  'after',
  'before',
  'between',
  'concept',
  'concepts',
  'during',
  'from',
  'into',
  'over',
  'that',
  'their',
  'there',
  'these',
  'this',
  'topic',
  'under',
  'understand',
  'understanding',
  'with',
]);

const EXPANSION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    nodes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          label: { type: 'STRING' },
          summary: { type: 'STRING' },
          description: { type: 'STRING' },
          question: { type: 'STRING' },
        },
        required: ['id', 'label', 'summary', 'description', 'question'],
      },
    },
  },
  required: ['nodes'],
};

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function dedupeByLabel(definitions, existingChildren) {
  const seen = new Set(
    (existingChildren || []).map((label) => String(label).trim().toLowerCase()),
  );
  const unique = [];

  for (const definition of definitions) {
    const key = String(definition.label).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(definition);
  }

  return unique;
}

function meaningfulWords(text) {
  return Array.from(
    new Set(
      String(text || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 3 && !STOP_WORDS.has(word)),
    ),
  );
}

function makeQuestion(label, parentLabel, rootTopic) {
  const focus = label || parentLabel || rootTopic;
  return `How would you explain ${focus} in your own words, and why does it matter for ${rootTopic}?`;
}

function makeNodeId(parentId, label, index) {
  const slug = slugify(label) || `child-${index + 1}`;
  return `${parentId}--${slug}`;
}

function topicSpecificDefinitions(context) {
  const rootTopic = String(context.rootTopic || '').toLowerCase();
  const nodeLabel = String(context.nodeLabel || '').toLowerCase();

  if (context.depth === 0 && rootTopic.includes('linear algebra')) {
    return [
      {
        label: 'Vectors and Vector Operations',
        summary: 'Represent quantities, directions, and the arithmetic that combines them.',
        description: 'Vectors are the basic objects of linear algebra. Build intuition for magnitude, direction, and how vector operations combine information.',
      },
      {
        label: 'Matrices and Matrix Operations',
        summary: 'Use matrices to organize information and transform vectors.',
        description: 'Matrices package coefficients and transformations into a structured object that can scale ideas from single equations to whole systems.',
      },
      {
        label: 'Solving Linear Systems',
        summary: 'Interpret what solutions mean and how methods uncover them.',
        description: 'Linear systems connect equations, geometry, and computation. Understanding what a solution means makes later techniques feel purposeful.',
      },
    ];
  }

  if (nodeLabel.includes('vectors')) {
    return [
      {
        label: 'Magnitude and Direction',
        summary: 'See vectors as quantities defined by size and orientation.',
        description: 'Vector intuition starts with recognizing that a vector captures both how much and which way, not just a single number.',
      },
      {
        label: 'Vector Addition and Scaling',
        summary: 'Combine vectors and stretch them without losing meaning.',
        description: 'Adding vectors and multiplying by scalars are the core operations that make vectors useful in geometry, physics, and algebra.',
      },
      {
        label: 'Linear Combinations',
        summary: 'Build new vectors from weighted sums of existing ones.',
        description: 'Linear combinations are the bridge from simple vector operations to span, basis, and the structure of vector spaces.',
      },
    ];
  }

  if (nodeLabel.includes('matrices')) {
    return [
      {
        label: 'Reading Entries and Dimensions',
        summary: 'Interpret what matrix rows, columns, and sizes describe.',
        description: 'Matrix fluency begins with understanding what each entry means and why dimensions control which operations make sense.',
      },
      {
        label: 'Matrix-Vector Multiplication',
        summary: 'Connect matrices to actions on vectors, not just number grids.',
        description: 'Matrix-vector multiplication is the first place matrices become meaningful transformations instead of static tables.',
      },
      {
        label: 'Matrix Multiplication and Composition',
        summary: 'See multiplication as chaining transformations together.',
        description: 'Understanding matrix multiplication as composition keeps the rule from feeling arbitrary and prepares you for linear maps.',
      },
    ];
  }

  if (nodeLabel.includes('linear systems')) {
    return [
      {
        label: 'What a Solution Means',
        summary: 'Interpret solutions as values satisfying every equation at once.',
        description: 'Students often manipulate systems mechanically before understanding that a solution must make every equation true simultaneously.',
      },
      {
        label: 'Elimination as Structured Rewriting',
        summary: 'Use row operations to simplify without changing the solution set.',
        description: 'Elimination works because each allowed transformation preserves the underlying relationships in the system.',
      },
      {
        label: 'Geometric Interpretation',
        summary: 'Relate algebraic systems to intersecting lines or planes.',
        description: 'The geometry of a system gives intuition for uniqueness, inconsistency, and infinite families of solutions.',
      },
    ];
  }

  if (context.depth === 0 && rootTopic.includes('photosynthesis')) {
    return [
      {
        label: 'Energy Capture from Light',
        summary: 'Understand how light energy is absorbed and redirected.',
        description: 'Photosynthesis begins by capturing light energy and using it to drive chemical work inside the chloroplast.',
      },
      {
        label: 'Carbon Fixation and Sugar Building',
        summary: 'Follow how carbon dioxide becomes stored chemical energy.',
        description: 'The plant turns carbon dioxide into sugar through a coordinated set of reactions that depends on earlier light-driven steps.',
      },
      {
        label: 'Why Photosynthesis Sustains Ecosystems',
        summary: 'Connect the process to food webs, oxygen, and energy flow.',
        description: 'Photosynthesis matters beyond the cell because it shapes atmospheric gases and supplies usable energy to ecosystems.',
      },
    ];
  }

  return null;
}

function genericDefinitions(context) {
  const focus = context.depth === 0 ? context.rootTopic : context.nodeLabel;
  const words = meaningfulWords(focus);
  const keyword = words[0] || focus;

  if (context.depth === 0) {
    return [
      {
        label: `Foundations of ${focus}`,
        summary: `Build the core vocabulary and mental model behind ${focus}.`,
        description: `This branch establishes the basic language and first principles that make the rest of ${focus} understandable.`,
      },
      {
        label: `${focus} Core Ideas`,
        summary: `Identify the big ideas that organize the rest of ${focus}.`,
        description: `This branch gathers the most important ideas a beginner should internalize before worrying about edge cases or memorized procedures.`,
      },
      {
        label: `Applying ${focus}`,
        summary: `Use ${focus} to reason, solve problems, or explain examples.`,
        description: `This branch shifts from definitions to practical reasoning so the learner can use ${focus} instead of only naming it.`,
      },
    ];
  }

  return [
    {
      label: `${focus}: intuition`,
      summary: `Build a mental picture for how ${keyword} behaves.`,
      description: `This branch focuses on intuition so the learner can explain ${focus} without relying on memorized phrases.`,
    },
    {
      label: `${focus}: structure`,
      summary: `Understand the rules, parts, and relationships inside ${focus}.`,
      description: `This branch looks at how the pieces of ${focus} fit together and why those relationships matter.`,
    },
    {
      label: `${focus}: examples`,
      summary: `Test ${focus} against concrete examples and common mistakes.`,
      description: `This branch turns ${focus} into something tangible by using examples, counterexamples, and practical reasoning.`,
    },
  ];
}

function fallbackNodes({ nodeId, context }) {
  const nextDepth = Number(context.depth || 0) + 1;
  const definitions =
    topicSpecificDefinitions(context) || genericDefinitions(context);
  const uniqueDefinitions = dedupeByLabel(definitions, context.existingChildren).slice(0, 3);

  return uniqueDefinitions.map((definition, index) => ({
    id: makeNodeId(nodeId, definition.label, index),
    label: definition.label,
    parentId: nodeId,
    summary: definition.summary,
    description: definition.description,
    expandable: nextDepth < 3,
    metadata: {
      question:
        definition.question ||
        makeQuestion(definition.label, context.nodeLabel, context.rootTopic),
      status: 'ready',
      depth: nextDepth,
      parentTopic: context.nodeLabel,
    },
  }));
}

function normalizeGeneratedNodes({ nodeId, context, payload }) {
  const nextDepth = Number(context.depth || 0) + 1;
  const generatedNodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
  const uniqueDefinitions = dedupeByLabel(
    generatedNodes
      .map((node) => ({
        label: String(node?.label || '').trim(),
        summary: String(node?.summary || '').trim(),
        description: String(node?.description || '').trim(),
        question: String(node?.question || '').trim(),
      }))
      .filter((node) => node.label && node.summary && node.description),
    context.existingChildren,
  ).slice(0, 3);

  if (!uniqueDefinitions.length) {
    return null;
  }

  return uniqueDefinitions.map((definition, index) => ({
    id: makeNodeId(nodeId, definition.label, index),
    label: definition.label,
    parentId: nodeId,
    summary: definition.summary,
    description: definition.description,
    expandable: nextDepth < 3,
    metadata: {
      question:
        definition.question ||
        makeQuestion(definition.label, context.nodeLabel, context.rootTopic),
      status: 'ready',
      depth: nextDepth,
      parentTopic: context.nodeLabel,
    },
  }));
}

async function maybeGenerateNodes({ nodeId, context, fallback }) {
  const suggestionText = fallback
    .map((node, index) => `${index + 1}. ${node.label} — ${node.summary}`)
    .join('\n');

  let researchText = '';
  if (Number(context.depth || 0) === 0) {
    console.log(`[expand] Researching "${context.rootTopic}" with gemini-2.5-flash + Google Search...`);
    const t = Date.now();
    researchText =
      (await generateText({
        model: MODEL_FLASH,
        prompt: `Research the three most important beginner concepts someone should understand before learning "${context.rootTopic}". Keep it concise and pedagogical.`,
        config: groundedConfig,
      })) || '';
    console.log(`[expand] Research complete (${Date.now() - t}ms). researchText length: ${researchText.length}`);
  }

  console.log(`[expand] Structuring nodes for "${context.nodeLabel}" (depth ${context.depth}) with gemini-2.5-flash...`);
  const t2 = Date.now();
  const generated = await generateStructuredJson({
    model: MODEL_FLASH,
    prompt: [
      `You are designing beginner learning-tree nodes for the broader topic "${context.rootTopic}".`,
      `Expand the branch "${context.nodeLabel}" at depth ${context.depth}.`,
      `Return exactly 3 child nodes that are distinct, beginner-friendly, and test understanding rather than recall.`,
      `Each node must include: label, summary (<= 25 words), description (<= 80 words), question (<= 2 sentences).`,
      context.existingChildren?.length
        ? `Avoid duplicates of these existing children: ${context.existingChildren.join(', ')}.`
        : 'There are no existing child nodes yet.',
      researchText ? `Grounding notes:\n${researchText}` : '',
      `Fallback suggestions for tone and scope:\n${suggestionText}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    schema: EXPANSION_SCHEMA,
    config: structuredConfig(EXPANSION_SCHEMA),
  });
  console.log(`[expand] Structuring complete (${Date.now() - t2}ms). Got ${generated?.nodes?.length ?? 0} nodes. Source: ${generated ? 'GEMINI' : 'FALLBACK'}`);
  if (generated?.nodes) {
    generated.nodes.forEach(n => console.log(`  → ${n.label}`));
  }

  return normalizeGeneratedNodes({ nodeId, context, payload: generated });
}

export async function expandNode({ nodeId, context }) {
  const normalizedContext = {
    rootTopic: String(context?.rootTopic || context?.nodeLabel || 'Learning Tree'),
    nodeLabel: String(context?.nodeLabel || context?.rootTopic || 'Topic'),
    depth: Number(context?.depth || 0),
    path: Array.isArray(context?.path) ? context.path : [],
    existingChildren: Array.isArray(context?.existingChildren)
      ? context.existingChildren
      : [],
  };

  const fallback = fallbackNodes({ nodeId, context: normalizedContext });
  const generated = await maybeGenerateNodes({
    nodeId,
    context: normalizedContext,
    fallback,
  });

  return {
    parentId: nodeId,
    parentPatch: { expandable: false },
    nodes: generated || fallback,
  };
}
