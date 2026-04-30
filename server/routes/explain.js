import { explainNode } from '../vertex/explainNode.js';

export default async function explainRoute(req, res) {
  const payload = req.body;

  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'An explanation payload is required.' });
    return;
  }

  const nodeLabel = String(payload.nodeLabel || '').trim();
  const topic = String(payload.topic || '').trim();

  if (!nodeLabel || !topic) {
    res.status(400).json({ error: 'topic and nodeLabel are required.' });
    return;
  }

  const response = await explainNode(payload);
  res.json(response);
}
