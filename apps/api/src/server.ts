import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { defaultDbPath, openDb } from './db.js';

const port = Number(process.env.PORT ?? 3001);
const app = createApp(openDb(defaultDbPath()));
serve({ fetch: app.fetch, port }, () => console.log(`API listening on http://localhost:${port}`));
