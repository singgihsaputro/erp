import { Hono } from 'hono';
import { productInputSchema, productListQuerySchema, type Page, type Product } from '@erp/shared';
import type { Db } from './db.js';
import { HttpError, parse, parseId, readJson } from './http.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export function productRoutes(db: Db) {
  const app = new Hono();

  const find = (id: number) => db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Product | undefined;
  const mustFind = (id: number) => {
    const p = find(id);
    if (!p) throw new HttpError(404, 'Product not found');
    return p;
  };

  function assertUnique(input: { sku: string; barcode: string | null }, exceptId = 0) {
    const sku = db.prepare('SELECT id FROM products WHERE sku = ? AND id != ?').get(input.sku, exceptId);
    if (sku) throw new HttpError(409, `SKU ${input.sku} is already used`);
    if (input.barcode) {
      const bc = db.prepare('SELECT id FROM products WHERE barcode = ? AND id != ?').get(input.barcode, exceptId);
      if (bc) throw new HttpError(409, `Barcode ${input.barcode} is already used`);
    }
  }

  app.get('/', (c) => {
    const query = parse(productListQuerySchema, c.req.query());
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.status === 'active') where.push('archived_at IS NULL');
    if (query.status === 'archived') where.push('archived_at IS NOT NULL');
    if (query.q) {
      where.push("(name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\' OR barcode LIKE ? ESCAPE '\\')");
      const like = `%${query.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      params.push(like, like, like);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM products ${clause}`).get(...params) as { n: number }).n;
    const items = db
      .prepare(`SELECT * FROM products ${clause} ORDER BY name COLLATE NOCASE, id LIMIT ? OFFSET ?`)
      .all(...params, query.page_size, (query.page - 1) * query.page_size) as Product[];
    const body: Page<Product> = { items, total, page: query.page, page_size: query.page_size };
    return c.json(body);
  });

  app.get('/:id', (c) => c.json(mustFind(parseId(c.req.param('id')))));

  app.post('/', async (c) => {
    const input = parse(productInputSchema, await readJson(c));
    assertUnique(input);
    const r = db
      .prepare('INSERT INTO products (sku, barcode, name, base_unit, cost, price) VALUES (?, ?, ?, ?, ?, ?)')
      .run(input.sku, input.barcode, input.name, input.base_unit, input.cost, input.price);
    return c.json(find(Number(r.lastInsertRowid)), 201);
  });

  app.put('/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    mustFind(id);
    const input = parse(productInputSchema, await readJson(c));
    assertUnique(input, id);
    db.prepare(
      `UPDATE products SET sku = ?, barcode = ?, name = ?, base_unit = ?, cost = ?, price = ?, updated_at = ${NOW} WHERE id = ?`,
    ).run(input.sku, input.barcode, input.name, input.base_unit, input.cost, input.price, id);
    return c.json(find(id));
  });

  app.post('/:id/archive', (c) => {
    const id = parseId(c.req.param('id'));
    if (mustFind(id).archived_at) throw new HttpError(409, 'Product is already archived');
    db.prepare(`UPDATE products SET archived_at = ${NOW}, updated_at = ${NOW} WHERE id = ?`).run(id);
    return c.json(find(id));
  });

  app.post('/:id/restore', (c) => {
    const id = parseId(c.req.param('id'));
    if (!mustFind(id).archived_at) throw new HttpError(409, 'Product is not archived');
    db.prepare(`UPDATE products SET archived_at = NULL, updated_at = ${NOW} WHERE id = ?`).run(id);
    return c.json(find(id));
  });

  return app;
}
