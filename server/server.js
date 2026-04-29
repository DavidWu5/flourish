import './env.js';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import seedRoute from './routes/seed.js';
import expandRoute from './routes/expand.js';
import diagnoseRoute from './routes/diagnose.js';

const app = express();
app.use(express.json({ limit: '256kb' }));

app.post('/api/tree/seed', seedRoute);
app.post('/api/tree/expand', expandRoute);
app.post('/api/node/diagnose', diagnoseRoute);

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const entryHtml = path.join(projectRoot, 'index.html');

const staticExtensions = new Set([
  '.css',
  '.gif',
  '.html',
  '.ico',
  '.jpeg',
  '.jpg',
  '.js',
  '.map',
  '.png',
  '.svg',
  '.webp',
]);

function isBlockedPath(normalizedPath) {
  return (
    normalizedPath.startsWith('/.git') ||
    normalizedPath.startsWith('/.claude') ||
    normalizedPath.startsWith('/server') ||
    normalizedPath.startsWith('/node_modules')
  );
}

function resolveFrontendPath(requestPath = '/') {
  const normalizedPath = path.posix.normalize(requestPath || '/');
  if (isBlockedPath(normalizedPath)) {
    return null;
  }

  const relativePath =
    normalizedPath === '/' ? 'index.html' : normalizedPath.replace(/^\/+/, '');
  const resolvedPath = path.resolve(projectRoot, relativePath);

  if (
    resolvedPath !== projectRoot &&
    !resolvedPath.startsWith(`${projectRoot}${path.sep}`)
  ) {
    return null;
  }

  return resolvedPath;
}

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    next();
    return;
  }

  if (!path.extname(req.path)) {
    res.sendFile(entryHtml);
    return;
  }

  if (!staticExtensions.has(path.extname(req.path).toLowerCase())) {
    next();
    return;
  }

  const candidate = resolveFrontendPath(req.path);
  if (!candidate) {
    next();
    return;
  }

  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    res.sendFile(candidate);
    return;
  }

  next();
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

app.use((error, req, res, _next) => {
  console.error(error);

  if (req.path.startsWith('/api/')) {
    res.status(500).json({
      error:
        error instanceof Error && error.message
          ? error.message
          : 'Unexpected API error.',
    });
    return;
  }

  res.status(500).send('Internal Server Error');
});

const port = Number(process.env.PORT) || 3000;
const entryFile = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === entryFile;

if (isDirectRun) {
  app.listen(port, () => {
    console.log(`flourish -> http://localhost:${port}`);
  });
}

export default app;
