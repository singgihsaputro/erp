import { Hono } from 'hono';
import { categoryInputSchema, unitCreateSchema, unitUpdateSchema, type Category, type Unit } from '@erp/shared';
import type { Db } from './db.js';
import { HttpError, parse, parseId, readJson } from './http.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export function categoryRoutes(db: Db) {
  const app = new Hono();
  const find = (id: number) =>
    db
      .prepare(
        'SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count FROM categories c WHERE c.id = ?',
      )
      .get(id) as Category | undefined;
  const mustFind = (id: number) => {
    const c = find(id);
    if (!c) throw new HttpError(404, 'Category not found');
    return c;
  };
  const assertFree = (name: string, exceptId = 0) => {
    if (db.prepare('SELECT 1 FROM categories WHERE name = ? AND id != ?').get(name, exceptId)) {
      throw new HttpError(409, `Category ${name} already exists`);
    }
  };

  app.get('/', (c) =>
    c.json(
      db
        .prepare(
          `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
           FROM categories c ORDER BY c.name COLLATE NOCASE`,
        )
        .all() as Category[],
    ),
  );

  app.post('/', async (c) => {
    const input = parse(categoryInputSchema, await readJson(c));
    assertFree(input.name);
    const r = db.prepare('INSERT INTO categories (name) VALUES (?)').run(input.name);
    return c.json(find(Number(r.lastInsertRowid)), 201);
  });

  app.put('/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    mustFind(id);
    const input = parse(categoryInputSchema, await readJson(c));
    assertFree(input.name, id);
    db.prepare(`UPDATE categories SET name = ?, updated_at = ${NOW} WHERE id = ?`).run(input.name, id);
    return c.json(find(id));
  });

  app.delete('/:id', (c) => {
    const id = parseId(c.req.param('id'));
    const cat = mustFind(id);
    if (cat.product_count > 0) {
      throw new HttpError(409, `${cat.product_count} product(s) still use this category; move them first`);
    }
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    return c.json({ ok: true });
  });

  return app;
}

export function unitRoutes(db: Db) {
  const app = new Hono();
  const find = (id: number) => db.prepare('SELECT * FROM units WHERE id = ?').get(id) as Unit | undefined;
  const mustFind = (id: number) => {
    const u = find(id);
    if (!u) throw new HttpError(404, 'Unit not found');
    return u;
  };

  app.get('/', (c) =>
    c.json(
      db
        .prepare(
          `SELECT u.*,
             (SELECT COUNT(*) FROM products p WHERE p.base_unit = u.code COLLATE NOCASE) AS base_count,
             (SELECT COUNT(*) FROM product_units pu WHERE pu.unit = u.code) AS conversion_count
           FROM units u ORDER BY u.code COLLATE NOCASE`,
        )
        .all(),
    ),
  );

  app.post('/', async (c) => {
    const input = parse(unitCreateSchema, await readJson(c));
    if (db.prepare('SELECT 1 FROM units WHERE code = ?').get(input.code)) {
      throw new HttpError(409, `Unit ${input.code} already exists`);
    }
    const r = db.prepare('INSERT INTO units (code, name) VALUES (?, ?)').run(input.code, input.name);
    return c.json(find(Number(r.lastInsertRowid)), 201);
  });

  // The code is how products refer to the unit, so only the display name can change.
  app.put('/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    mustFind(id);
    const input = parse(unitUpdateSchema, await readJson(c));
    db.prepare(`UPDATE units SET name = ?, updated_at = ${NOW} WHERE id = ?`).run(input.name, id);
    return c.json(find(id));
  });

  app.delete('/:id', (c) => {
    const id = parseId(c.req.param('id'));
    const u = mustFind(id);
    const used =
      (db.prepare('SELECT COUNT(*) AS n FROM products WHERE base_unit = ? COLLATE NOCASE').get(u.code) as { n: number }).n +
      (db.prepare('SELECT COUNT(*) AS n FROM product_units WHERE unit = ?').get(u.code) as { n: number }).n;
    if (used > 0) throw new HttpError(409, `Unit ${u.code} is used by products and cannot be deleted`);
    db.prepare('DELETE FROM units WHERE id = ?').run(id);
    return c.json({ ok: true });
  });

  return app;
}
