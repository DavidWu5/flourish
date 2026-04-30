import { generateNodeQuestion } from '../vertex/questionNode.js';

export default async function questionRoute(req, res) {
  const payload = req.body;

  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'A question payload is required.' });
    return;
  }

  const topic = String(payload.topic || '').trim();
  const nodeLabel = String(payload.nodeLabel || '').trim();

  if (!topic || !nodeLabel) {
    res.status(400).json({ error: 'topic and nodeLabel are required.' });
    return;
  }

  const response = await generateNodeQuestion(payload);
  res.json(response);
}
