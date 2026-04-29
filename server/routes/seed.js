function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function createSeedResponse(topic) {
  const cleanTopic = String(topic || 'Learning Tree').trim() || 'Learning Tree';
  const rootId = `root-${slugify(cleanTopic) || 'topic'}`;

  return {
    root: {
      id: rootId,
      label: cleanTopic,
      parentId: null,
      summary: `A learning tree for ${cleanTopic}.`,
      description: `${cleanTopic} is the root of this learning tree. Start with the first branches, then answer each diagnostic question to prove understanding before the tree grows further.`,
      expandable: true,
      metadata: {
        role: 'Root topic',
        status: 'Ready to grow',
      },
    },
    nodes: [],
  };
}

export default function seedRoute(req, res) {
  const topic = String(req.body?.topic || '').trim();

  if (!topic) {
    res.status(400).json({ error: 'A topic is required.' });
    return;
  }

  res.json(createSeedResponse(topic));
}
