import { diagnoseAnswer } from '../vertex/diagnose.js';

export default async function diagnoseRoute(req, res) {
  const payload = req.body;

  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'A diagnosis payload is required.' });
    return;
  }

  const nodeId = String(payload.nodeId || '').trim();
  const nodeLabel = String(payload.nodeLabel || '').trim();
  const question = String(payload.question || '').trim();

  if (!nodeId || !nodeLabel || !question) {
    res.status(400).json({
      error: 'nodeId, nodeLabel, and question are required.',
    });
    return;
  }

  const diagnosis = await diagnoseAnswer(payload);
  res.json(diagnosis);
}
