// S-AI — Vercel Serverless entrypoint.
//
// Mounts the full S-AI Express app (static dashboard + API) as a single
// Vercel Node.js function. This preserves the exact behaviour of `s-ai serve`
// (same routes, static file serving, and the `*` SPA fallback) under serverless.
//
// Configuration is entirely env-driven (set these on the Vercel project):
//   SAI_API_KEY    -> bearer token protected routes require (deterministic auth)
//   SAI_AUTH_MODE  -> "off" disables auth (public demo); default respects SAI_API_KEY
//   SAI_DATA_DIR   -> writable dir for persistent state (graph/persona). On
//                     serverless this is ephemeral (/tmp); use a durable store
//                     for long-lived memory in production.
//   OPENROUTER_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / ... -> AI providers
//
// Notes on serverless constraints:
//   - State written under SAI_DATA_DIR is per-invocation and non-persistent.
//   - `npm run build` must run before deploy so ../dist/src/server.js exists.

import { createServer } from '../dist/src/server.js';

let appPromise;

async function getApp() {
  if (!appPromise) {
    // process.cwd() is the function root on Vercel; it contains ./public and ./dist.
    appPromise = createServer({ listen: false, root: process.cwd() });
  }
  return appPromise;
}

export default async function handler(req, res) {
  const app = await getApp();
  return app(req, res);
}
