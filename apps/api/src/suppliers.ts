import { Hono } from 'hono';
import { supplierInputSchema, type Supplier, type SupplierInput } from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, parseId, readJson } from './http.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** Who may create, edit and archive suppliers. Everyone signed in may look. */
export const SUPPLIER_MANAGERS = ['super_admin', 'owner', 'admin'] as const;

type Parsed = ReturnType<typeof supplierInputSchema.parse>;

export function supplierRoutes(db: Db) {
  const app = new Hono();
  const manage = requireRole(...SUPPLIER_MANAGERS);
  app.use('*', (c, next) => (c.req.method === 'GET' ? next() : manage(c as never, next)));

  const find = (id: number) => db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as Supplier | undefined;
  const mustFind = (id: number) => {
    const s = find(id);
    if (!s) throw new HttpError(404, 'Supplier not found');
    return s;
  };
  const assertFree = (input: Parsed, exceptId = 0) => {
    if (db.prepare('SELECT 1 FROM suppliers WHERE name = ? COLLATE NOCASE AND id != ? AND archived_at IS NULL').get(input.name, exceptId)) {
      throw new HttpError(409, `Supplier ${input.name} already exists`);
    }
    if (input.npwp && db.prepare("SELECT 1 FROM suppliers WHERE npwp = ? AND id != ? AND archived_at IS NULL").get(input.npwp, exceptId)) {
      throw new HttpError(409, `NPWP ${input.npwp} already belongs to another supplier`);
    }
  };
  const cols = (i: Parsed) => [i.name, i.contact_person, i.phone, i.email, i.address, i.npwp, i.payment_terms, i.note];

  app.get('/', (c) => {
    const archived = c.req.query('archived') === '1';
    const q = (c.req.query('q') ?? '').trim();
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = db
      .prepare(
        `SELECT * FROM suppliers WHERE archived_at IS ${archived ? 'NOT NULL' : 'NULL'}
         AND (? = '' OR name LIKE ? ESCAPE '\\' OR contact_person LIKE ? ESCAPE '\\' OR npwp LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')
         ORDER BY name COLLATE NOCASE`,
      )
      .all(q, like, like, like, like) as Supplier[];
    return c.json(rows);
  });

  app.get('/:id', (c) => c.json(mustFind(parseId(c.req.param('id')))));

  app.post('/', async (c) => {
    const input = parse(supplierInputSchema, await readJson(c));
    assertFree(input);
    const r = db
      .prepare('INSERT INTO suppliers (name, contact_person, phone, email, address, npwp, payment_terms, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(...cols(input));
    return c.json(find(Number(r.lastInsertRowid)), 201);
  });

  app.put('/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    mustFind(id);
    const input = parse(supplierInputSchema, await readJson(c));
    assertFree(input, id);
    db.prepare(
      `UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, npwp = ?, payment_terms = ?, note = ?, updated_at = ${NOW} WHERE id = ?`,
    ).run(...cols(input), id);
    return c.json(find(id));
  });

  app.post('/:id/archive', (c) => {
    const id = parseId(c.req.param('id'));
    if (mustFind(id).archived_at) throw new HttpError(409, 'Supplier is already archived');
    db.prepare(`UPDATE suppliers SET archived_at = ${NOW}, updated_at = ${NOW} WHERE id = ?`).run(id);
    return c.json(find(id));
  });

  app.post('/:id/restore', (c) => {
    const id = parseId(c.req.param('id'));
    const s = mustFind(id);
    if (!s.archived_at) throw new HttpError(409, 'Supplier is not archived');
    assertFree(supplierInputSchema.parse(s as SupplierInput), id);
    db.prepare(`UPDATE suppliers SET archived_at = NULL, updated_at = ${NOW} WHERE id = ?`).run(id);
    return c.json(find(id));
  });

  return app;
}
