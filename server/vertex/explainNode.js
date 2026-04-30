import { generateStructuredJson } from './client.js';
import { MODEL_FLASH, structuredConfig } from './models.js';

const EXPLAIN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    perspective_label: { type: 'STRING' },
    spark_title: { type: 'STRING' },
    gentle_explanation: { type: 'STRING' },
    analogy: { type: 'STRING' },
    micro_example: { type: 'STRING' },
    why_it_matters: { type: 'STRING' },
    next_step_prompt: { type: 'STRING' },
    encouragement: { type: 'STRING' },
  },
  required: [
    'perspective_label',
    'spark_title',
    'gentle_explanation',
    'analogy',
    'micro_example',
    'why_it_matters',
    'next_step_prompt',
    'encouragement',
  ],
};

function fallbackExplainNode(payload) {
  const topic = String(payload.topic || 'this topic');
  const nodeLabel = String(payload.nodeLabel || 'this branch');
  const summary = String(payload.summary || '').trim();
  const description = String(payload.description || '').trim();
  const misconception = String(payload.lastMisconception || '').trim();
  const lens = String(payload.lens || 'intuition');

  const gentleExplanation = misconception
    ? `${nodeLabel} can feel slippery when the missing idea is ${misconception.toLowerCase()}. Start smaller: focus on what ${nodeLabel} is helping you notice, then connect that back to ${topic}.`
    : `${nodeLabel} does not need to make sense all at once. Start with the central job it does inside ${topic}, then let the details hang off that core picture.`;

  const analogy =
    lens === 'analogy'
      ? `Think of ${nodeLabel} like a handhold on a climbing wall: it is not the whole route, but once you trust it, the next move stops feeling so intimidating.`
      : `You can treat ${nodeLabel} like a lens: it does not change the topic, it changes what becomes easier to see.`;

  const microExample = summary
    ? `A tiny way in: "${summary}" Try saying that out loud in your own words, then add one concrete example from your life or from class.`
    : `A tiny way in: explain ${nodeLabel} to an imaginary friend in one sentence, then test whether your sentence would help them predict anything useful.`;

  return {
    perspective_label:
      lens === 'analogy'
        ? 'A familiar analogy'
        : lens === 'example'
          ? 'A concrete foothold'
          : lens === 'big-picture'
            ? 'Back to the big picture'
            : 'A gentler way in',
    spark_title: `See ${nodeLabel} more clearly`,
    gentle_explanation:
      description || gentleExplanation,
    analogy,
    micro_example: microExample,
    why_it_matters: `${nodeLabel} matters because it makes later parts of ${topic} feel connected instead of random.`,
    next_step_prompt: `What would change in your explanation of ${topic} if ${nodeLabel} suddenly made sense?`,
    encouragement: 'You do not need the whole tree at once. One branch clicking into place is enough progress for now.',
  };
}

function normalizeExplainResponse(payload, raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const requiredKeys = [
    'perspective_label',
    'spark_title',
    'gentle_explanation',
    'analogy',
    'micro_example',
    'why_it_matters',
    'next_step_prompt',
    'encouragement',
  ];

  if (!requiredKeys.every((key) => String(raw[key] || '').trim())) {
    return null;
  }

  return {
    perspective_label: String(raw.perspective_label).trim(),
    spark_title: String(raw.spark_title).trim(),
    gentle_explanation: String(raw.gentle_explanation).trim(),
    analogy: String(raw.analogy).trim(),
    micro_example: String(raw.micro_example).trim(),
    why_it_matters: String(raw.why_it_matters).trim(),
    next_step_prompt: String(raw.next_step_prompt).trim(),
    encouragement: String(raw.encouragement).trim(),
  };
}

export async function explainNode(payload) {
  const fallback = fallbackExplainNode(payload);

  const generated = await generateStructuredJson({
    model: MODEL_FLASH,
    prompt: [
      'You are Flourish, a warm learning guide who reduces overwhelm and makes hard ideas feel approachable.',
      `Broader topic: ${payload.topic}`,
      `Current branch: ${payload.nodeLabel}`,
      payload.summary ? `Short summary: ${payload.summary}` : '',
      payload.description ? `Longer description: ${payload.description}` : '',
      Array.isArray(payload.path) ? `Path in the learning tree: ${payload.path.join(' / ')}` : '',
      payload.lastUnderstandingLevel ? `Last understanding result: ${payload.lastUnderstandingLevel}` : '',
      payload.lastFeedbackMessage ? `Last learner feedback: ${payload.lastFeedbackMessage}` : '',
      payload.lastMisconception ? `Likely misconception: ${payload.lastMisconception}` : '',
      payload.missingPrerequisite ? `Missing prerequisite: ${payload.missingPrerequisite}` : '',
      `Requested lens: ${payload.lens || 'intuition'}`,
      'Return a response that feels encouraging, vivid, and beginner-friendly.',
      'Do not sound like a textbook. Use plain language, one concrete analogy, one tiny example, and one curiosity-raising next-step prompt.',
      'Keep each field concise and high-signal.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    schema: EXPLAIN_SCHEMA,
    config: structuredConfig(EXPLAIN_SCHEMA),
  });

  return normalizeExplainResponse(payload, generated) || fallback;
}
