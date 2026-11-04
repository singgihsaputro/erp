import { Hono } from 'hono';
import {
  productInputSchema,
  productListQuerySchema,
  productUnitsInputSchema,
  type Page,
  type Product,
  type ProductUnit,
} from '@erp/shared';
import type { Db } from './db.js';
import { HttpError, parse, parseId, readJson } from './http.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export function productRoutes(db: Db) {
  const app = new Hono();

  const SELECT = `SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id`;
  const find = (id: number) => db.prepare(`${SELECT} WHERE p.id = ?`).get(id) as Product | undefined;
  const mustFind = (id: number) => {
    const p = find(id);
    if (!p) throw new HttpError(404, 'Product not found');
    return p;
  };

  function assertUnique(input: { sku: string; barcode: string | null; base_unit: string; category_id: number | null }, exceptId = 0) {
    if (!db.prepare('SELECT 1 FROM units WHERE code = ?').get(input.base_unit)) {
      throw new HttpError(400, 'Validation failed', { fieldErrors: { base_unit: [`Unit ${input.base_unit} does not exist`] } });
    }
    if (input.category_id !== null && !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(input.category_id)) {
      throw new HttpError(400, 'Validation failed', { fieldErrors: { category_id: ['Category does not exist'] } });
    }
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
    if (query.status === 'active') where.push('p.archived_at IS NULL');
    if (query.status === 'archived') where.push('p.archived_at IS NOT NULL');
    if (query.category_id) {
      where.push('p.category_id = ?');
      params.push(query.category_id);
    }
    if (query.q) {
      where.push("(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.barcode LIKE ? ESCAPE '\\')");
      const like = `%${query.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      params.push(like, like, like);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM products p ${clause}`).get(...params) as { n: number }).n;
    const items = db
      .prepare(`${SELECT} ${clause} ORDER BY p.name COLLATE NOCASE, p.id LIMIT ? OFFSET ?`)
      .all(...params, query.page_size, (query.page - 1) * query.page_size) as Product[];
    const body: Page<Product> = { items, total, page: query.page, page_size: query.page_size };
    return c.json(body);
  });

  const unitsOf = (id: number) =>
    db.prepare('SELECT unit, factor_milli FROM product_units WHERE product_id = ? ORDER BY factor_milli, unit').all(id) as ProductUnit[];

  app.get('/:id/units', (c) => {
    const id = parseId(c.req.param('id'));
    mustFind(id);
    return c.json({ base_unit: find(id)!.base_unit, units: unitsOf(id) });
  });

  // Replaces the whole set of conversions to the base unit.
  app.put('/:id/units', async (c) => {
    const id = parseId(c.req.param('id'));
    const product = mustFind(id);
    const { units } = parse(productUnitsInputSchema, await readJson(c));
    const seen = new Set<string>();
    const errors: string[] = [];
    for (const u of units) {
      const code = u.unit.toLowerCase();
      if (code === product.base_unit.toLowerCase()) errors.push(`${u.unit} is already the base unit`);
      else if (seen.has(code)) errors.push(`${u.unit} is listed twice`);
      else if (!db.prepare('SELECT 1 FROM units WHERE code = ?').get(u.unit)) errors.push(`Unit ${u.unit} does not exist`);
      seen.add(code);
    }
    if (errors.length) throw new HttpError(400, 'Validation failed', { fieldErrors: { units: errors } });
    db.transaction(() => {
      db.prepare('DELETE FROM product_units WHERE product_id = ?').run(id);
      const ins = db.prepare(
        'INSERT INTO product_units (product_id, unit, factor_milli) VALUES (?, (SELECT code FROM units WHERE code = ?), ?)',
      );
      for (const u of units) ins.run(id, u.unit, u.factor_milli);
    })();
    return c.json({ base_unit: product.base_unit, units: unitsOf(id) });
  });

  app.get('/:id', (c) => c.json(mustFind(parseId(c.req.param('id')))));

  app.post('/', async (c) => {
    const input = parse(productInputSchema, await readJson(c));
    assertUnique(input);
    const r = db
      .prepare('INSERT INTO products (sku, barcode, name, base_unit, cost, price, category_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(input.sku, input.barcode, input.name, input.base_unit, input.cost, input.price, input.category_id);
    return c.json(find(Number(r.lastInsertRowid)), 201);
  });

  app.put('/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    const existing = mustFind(id);
    const input = parse(productInputSchema, await readJson(c));
    assertUnique(input, id);
    if (input.base_unit.toLowerCase() !== existing.base_unit.toLowerCase() && unitsOf(id).length > 0) {
      throw new HttpError(409, 'Remove the unit conversions before changing the base unit');
    }
    db.prepare(
      `UPDATE products SET sku = ?, barcode = ?, name = ?, base_unit = ?, cost = ?, price = ?, category_id = ?, updated_at = ${NOW} WHERE id = ?`,
    ).run(input.sku, input.barcode, input.name, input.base_unit, input.cost, input.price, input.category_id, id);
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
