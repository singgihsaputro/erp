import { Hono } from 'hono';
import type { Db } from './db.js';
import { HttpError } from './http.js';
import { productRoutes } from './products.js';

export function createApp(db: Db) {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/products', productRoutes(db));

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, details: err.details }, err.status);
    console.error(err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
