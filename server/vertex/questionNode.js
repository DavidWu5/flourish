import { generateStructuredJson } from './client.js';
import { MODEL_FLASH, structuredConfig } from './models.js';

const QUESTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    question: { type: 'STRING' },
    encouragement: { type: 'STRING' },
  },
  required: ['question', 'encouragement'],
};

function fallbackQuestion(payload) {
  const topic = String(payload.topic || 'this topic');
  const nodeLabel = String(payload.nodeLabel || 'this branch');
  const summary = String(payload.summary || '').trim();

  return {
    question: summary
      ? `In your own words, how would you explain ${nodeLabel}, and how does it help you make sense of ${topic}?`
      : `What is the big idea behind ${nodeLabel}, and why does it matter inside ${topic}?`,
    encouragement: 'You do not need a perfect answer — just show how you are thinking.',
  };
}

function normalizeQuestion(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const question = String(raw.question || '').trim();
  const encouragement = String(raw.encouragement || '').trim();
  if (!question) return null;

  return {
    question,
    encouragement,
  };
}

export async function generateNodeQuestion(payload) {
  const fallback = fallbackQuestion(payload);

  const generated = await generateStructuredJson({
    model: MODEL_FLASH,
    prompt: [
      'You are designing one diagnostic question for a learning tree.',
      `Broader topic: ${payload.topic}`,
      `Current branch: ${payload.nodeLabel}`,
      payload.summary ? `Summary: ${payload.summary}` : '',
      payload.description ? `Description: ${payload.description}` : '',
      Array.isArray(payload.path) ? `Path: ${payload.path.join(' / ')}` : '',
      'Return one short question that checks understanding, not memorization.',
      'The question should feel invitational rather than intimidating.',
      'Also return one brief encouragement line.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    schema: QUESTION_SCHEMA,
    config: structuredConfig(QUESTION_SCHEMA),
  });

  return normalizeQuestion(generated) || fallback;
}
