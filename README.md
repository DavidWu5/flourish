# Flourish

A learning app that grows a tree from any topic you type in. Each branch is a sub-concept; clicking one opens a short comprehension check. Get it right and the branch keeps growing. Get it wrong and the tree splices in a prerequisite — a stepping stone you need to understand first — between the branch you missed and its parent.

The idea is that a learner's tree should reshape itself around what they actually know, not what a textbook table of contents assumes.

## Running it locally

```
cd server
npm install
npm run dev
```

Then open http://localhost:3000.

You'll need a Gemini API key in `server/.env`:

```
GEMINI_API_KEY=your-key-here
PORT=3000
```

## Deploying

The repo is set up for Vercel. The `api/index.mjs` shim re-exports the Express app as a serverless function, and `vercel.json` rewrites all paths to it. To deploy:

```
vercel --prod
```

Set `GEMINI_API_KEY` once via `vercel env add` so the deployed function can reach the model.

## Tech stack

- **Frontend** — vanilla JavaScript, no framework. Tree is rendered as a single animated SVG by `tree-renderer.js`. Pan and zoom are hand-rolled.
- **Backend** — Node + Express. Five routes: `/api/tree/seed`, `/api/tree/expand`, `/api/node/diagnose`, `/api/node/explain`, `/api/node/question`.
- **LLM** — Google Gemini via `@google/genai`. Uses `gemini-2.5-flash-lite` for all calls. Structured JSON output is requested directly through the SDK's response schema.
- **Hosting** — Vercel (serverless function + static assets, all behind one rewrite rule).
- **Build** — none. No bundler, no transpiler. Files are served as written.

## Layout

```
api/index.mjs          Vercel function entry — re-exports the Express app
server/                Express app, routes, and Gemini wrapper
  vertex/              Gemini client and per-route prompt logic
index.html, app.js     Page shell and frontend wiring
tree-renderer.js       SVG tree with growth animations
tree-controller.js     Seed / expand orchestration, prefetch cache
question-flow.js       Comprehension check panel and prerequisite insertion
topic-entry.js         Topic input modal
styles.css             All styles
```
