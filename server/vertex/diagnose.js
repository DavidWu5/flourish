import { generateStructuredJson } from './client.js';
import { MODEL_FLASH, structuredConfig } from './models.js';

const NON_ANSWER_PATTERN =
  /^(?:\s*|idk|i don't know|dont know|not sure|unsure|no idea|skip|pass)\s*$/i;

const DIAGNOSIS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    understanding_level: { type: 'STRING' },
    tree_action: { type: 'STRING' },
    misconception: { type: 'STRING' },
    missing_prerequisite: { type: 'STRING' },
    feedback_message: { type: 'STRING' },
    new_node: {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING' },
        title: { type: 'STRING' },
        summary: { type: 'STRING' },
        description: { type: 'STRING' },
        question: { type: 'STRING' },
      },
      required: ['id', 'title', 'summary', 'description', 'question'],
    },
  },
  required: [
    'understanding_level',
    'tree_action',
    'misconception',
    'missing_prerequisite',
    'feedback_message',
    'new_node',
  ],
};

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'because',
  'before',
  'being',
  'branch',
  'concept',
  'explain',
  'first',
  'from',
  'have',
  'into',
  'learning',
  'node',
  'question',
  'should',
  'that',
  'their',
  'these',
  'they',
  'this',
  'topic',
  'understand',
  'understanding',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would',
]);

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function wordCount(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
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

function keywordOverlap(...texts) {
  const [source, target] = texts.map((text) => meaningfulWords(text));
  if (!source.length || !target.length) return 0;

  const targetSet = new Set(target);
  return source.filter((word) => targetSet.has(word)).length;
}

function prerequisiteTemplate(nodeLabel, topic) {
  const label = String(nodeLabel || '');
  const lower = label.toLowerCase();

  if (lower.includes('vector')) {
    return {
      title: 'Vector intuition',
      summary: 'Understand vectors as quantities with size and direction before manipulating them.',
      description: 'A learner needs a geometric feel for vectors before operations like addition, scaling, or span feel meaningful.',
      question:
        'What does a vector represent, and how can two vectors differ in both size and direction?',
    };
  }

  if (lower.includes('matrix')) {
    return {
      title: 'What a matrix represents',
      summary: 'See matrices as organized relationships or transformations, not just number grids.',
      description: 'Before matrix procedures make sense, the learner should know what information a matrix holds and what it can do.',
      question:
        'In your own words, what information does a matrix organize, and how can it act on a vector or system?',
    };
  }

  if (lower.includes('linear system')) {
    return {
      title: 'What a solution to a system means',
      summary: 'Interpret a solution as values that satisfy every equation at the same time.',
      description: 'Students often manipulate equations mechanically before understanding what it means for one answer to satisfy an entire system.',
      question:
        'What does it mean for a value or set of values to solve a system of equations?',
    };
  }

  if (lower.includes('photosynthesis')) {
    return {
      title: 'Energy and matter in plant cells',
      summary: 'Separate energy transfer from matter transformation before tackling the full process.',
      description: 'A solid mental model of how energy and matter move through a plant cell makes photosynthesis much easier to reason about.',
      question:
        'How are energy and matter playing different roles when a plant makes sugar?',
    };
  }

  return {
    title: `Foundations of ${label}`,
    summary: `Build the missing mental model needed before continuing with ${label}.`,
    description: `This prerequisite fills the gap that is blocking progress on ${label} inside the broader topic ${topic}.`,
    question: `What is the basic idea behind ${label}, and how would you explain it in plain language?`,
  };
}

function ensureUniqueId(baseId, existingNodeIds) {
  const taken = new Set((existingNodeIds || []).map((value) => String(value)));
  let candidate = baseId;
  let suffix = 1;

  while (taken.has(candidate)) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function fallbackDiagnosis(payload) {
  const topic = String(payload.topic || 'Learning Tree').trim() || 'Learning Tree';
  const nodeId = String(payload.nodeId || 'node').trim() || 'node';
  const nodeLabel = String(payload.nodeLabel || 'topic').trim() || 'topic';
  const question = String(payload.question || '').trim();
  const answer = String(payload.answer || '').trim();
  const overlap = keywordOverlap(`${nodeLabel} ${question}`, answer);
  const answerWords = wordCount(answer);

  if (NON_ANSWER_PATTERN.test(answer) || answerWords < 4) {
    const prerequisite = prerequisiteTemplate(nodeLabel, topic);
    return {
      understanding_level: 'wrong',
      tree_action: 'insert_prerequisite_node',
      misconception: `The answer does not yet show a working mental model for ${nodeLabel}.`,
      missing_prerequisite: prerequisite.title,
      feedback_message: "Something's missing — let's grow that support branch first.",
      new_node: {
        id: ensureUniqueId(`${nodeId}--prerequisite`, payload.existingNodeIds),
        ...prerequisite,
      },
    };
  }

  if (overlap >= 3 && answerWords >= 16) {
    return {
      understanding_level: 'correct',
      tree_action: 'continue',
      misconception: '',
      missing_prerequisite: '',
      feedback_message: 'Nice — this branch is strong.',
      new_node: null,
    };
  }

  if (overlap >= 2 && answerWords >= 10) {
    return {
      understanding_level: 'partial',
      tree_action: 'continue',
      misconception: `The answer gestures toward ${nodeLabel}, but the explanation is still too thin or imprecise.`,
      missing_prerequisite: '',
      feedback_message: `You're close — tighten the explanation of ${nodeLabel} and try again.`,
      new_node: null,
    };
  }

  const prerequisite = prerequisiteTemplate(nodeLabel, topic);
  return {
    understanding_level: 'wrong',
    tree_action: 'insert_prerequisite_node',
    misconception: `The answer is missing the underlying idea that makes ${nodeLabel} make sense.`,
    missing_prerequisite: prerequisite.title,
    feedback_message: "Let's strengthen the roots before we push this branch further.",
    new_node: {
      id: ensureUniqueId(`${nodeId}--prerequisite`, payload.existingNodeIds),
      ...prerequisite,
    },
  };
}

function normalizeDiagnosis(payload, raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const level = String(raw.understanding_level || '').trim().toLowerCase();
  const action = String(raw.tree_action || '').trim();

  if (!level || !action) {
    return null;
  }

  const normalized = {
    understanding_level:
      level === 'correct' || level === 'partial' || level === 'wrong'
        ? level
        : 'partial',
    tree_action: action,
    misconception: String(raw.misconception || '').trim(),
    missing_prerequisite: String(raw.missing_prerequisite || '').trim(),
    feedback_message: String(raw.feedback_message || '').trim(),
    new_node: null,
  };

  if (action === 'insert_prerequisite_node' && raw.new_node) {
    const prerequisite = prerequisiteTemplate(
      payload.nodeLabel,
      payload.topic || 'Learning Tree',
    );
    normalized.new_node = {
      id: ensureUniqueId(
        String(raw.new_node.id || `${payload.nodeId}--prerequisite`),
        payload.existingNodeIds,
      ),
      title: String(raw.new_node.title || prerequisite.title).trim(),
      summary: String(raw.new_node.summary || prerequisite.summary).trim(),
      description: String(
        raw.new_node.description || prerequisite.description,
      ).trim(),
      question: String(raw.new_node.question || prerequisite.question).trim(),
    };
  }

  return normalized;
}

async function maybeDiagnoseWithVertex(payload) {
  const existingNodeIds = Array.isArray(payload.existingNodeIds)
    ? payload.existingNodeIds.map((value) => String(value))
    : [];

  const raw = await generateStructuredJson({
    model: MODEL_FLASH,
    prompt: [
      'You are a diagnostic learning agent, not a tutor.',
      `Broader topic: ${payload.topic}`,
      `Node label: ${payload.nodeLabel}`,
      `Question: ${payload.question}`,
      `Learner answer: ${payload.answer}`,
      `Existing node ids: ${existingNodeIds.join(', ') || '(none)'}`,
      'Classify the answer as correct, partial, or wrong.',
      'If a missing prerequisite is blocking progress, set tree_action to insert_prerequisite_node and return a compact prerequisite node.',
      'Feedback message: under 40 words, action-oriented, no lectures.',
      "If the answer is empty or 'idk', treat it as wrong.",
    ].join('\n'),
    schema: DIAGNOSIS_SCHEMA,
    config: structuredConfig(DIAGNOSIS_SCHEMA),
  });

  return normalizeDiagnosis(payload, raw);
}

export async function diagnoseAnswer(payload) {
  const normalizedPayload = {
    topic: String(payload.topic || 'Learning Tree'),
    nodeId: String(payload.nodeId || slugify(payload.nodeLabel || 'node')),
    nodeLabel: String(payload.nodeLabel || 'topic'),
    question: String(payload.question || ''),
    answer: String(payload.answer || ''),
    parentId:
      payload.parentId === null || payload.parentId === undefined
        ? null
        : String(payload.parentId),
    existingNodeIds: Array.isArray(payload.existingNodeIds)
      ? payload.existingNodeIds
      : [],
  };

  const generated = await maybeDiagnoseWithVertex(normalizedPayload);
  return generated || fallbackDiagnosis(normalizedPayload);
}
