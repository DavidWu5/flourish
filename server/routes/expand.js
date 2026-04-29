import { expandNode } from '../vertex/expandNode.js';

export default async function expandRoute(req, res) {
  const nodeId = String(req.body?.nodeId || '').trim();
  const context = req.body?.context;

  if (!nodeId) {
    res.status(400).json({ error: 'A nodeId is required.' });
    return;
  }

  if (!context || typeof context !== 'object') {
    res.status(400).json({ error: 'A context object is required.' });
    return;
  }

  const response = await expandNode({ nodeId, context });
  res.json(response);
}
