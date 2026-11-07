import { Hono } from 'hono';
import { PRICE_TIERS, customerInputSchema, type Customer, type CustomerInput } from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, parseId, readJson } from './http.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** Who may create, edit and archive customers. Everyone signed in may look. */
export const CUSTOMER_MANAGERS = ['super_admin', 'owner', 'admin'] as const;

type Parsed = ReturnType<typeof customerInputSchema.parse>;

export function customerRoutes(db: Db) {
  const app = new Hono();
  const manage = requireRole(...CUSTOMER_MANAGERS);
  app.use('*', (c, next) => (c.req.method === 'GET' ? next() : manage(c as never, next)));

  const find = (id: number) => db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Customer | undefined;
  const mustFind = (id: number) => {
    const s = find(id);
    if (!s) throw new HttpError(404, 'Customer not found');
    return s;
  };
  const assertFree = (input: Parsed, exceptId = 0) => {
    if (db.prepare('SELECT 1 FROM customers WHERE name = ? COLLATE NOCASE AND id != ? AND archived_at IS NULL').get(input.name, exceptId)) {
      throw new HttpError(409, `Customer ${input.name} already exists`);
    }
    if (input.npwp && db.prepare("SELECT 1 FROM customers WHERE npwp = ? AND id != ? AND archived_at IS NULL").get(input.npwp, exceptId)) {
      throw new HttpError(409, `NPWP ${input.npwp} already belongs to another customer`);
    }
  };
  const cols = (i: Parsed) => [i.name, i.contact_person, i.phone, i.email, i.address, i.npwp, i.credit_limit, i.payment_terms, i.price_tier, i.note];

  app.get('/', (c) => {
    const archived = c.req.query('archived') === '1';
    const tier = c.req.query('tier') ?? '';
    if (tier && !(PRICE_TIERS as readonly string[]).includes(tier)) throw new HttpError(400, 'Unknown price tier');
    const q = (c.req.query('q') ?? '').trim();
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = db
      .prepare(
        `SELECT * FROM customers WHERE archived_at IS ${archived ? 'NOT NULL' : 'NULL'}
         AND (? = '' OR price_tier = ?) AND (? = '' OR name LIKE ? ESCAPE '\\' OR contact_person LIKE ? ESCAPE '\\' OR npwp LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')
         ORDER BY name COLLATE NOCASE`,
      )
      .all(tier, tier, q, like, like, like, like) as Customer[];
    return c.json(rows);
  });

  app.get('/:id', (c) => c.json(mustFind(parseId(c.req.param('id')))));

  app.post('/', async (c) => {
    const input = parse(customerInputSchema, await readJson(c));
    assertFree(input);
    const r = db
      .prepare('INSERT INTO customers (name, contact_person, phone, email, address, npwp, credit_limit, payment_terms, price_tier, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(...cols(input));
    return c.json(find(Number(r.lastInsertRowid)), 201);
  });

  app.put('/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    mustFind(id);
    const input = parse(customerInputSchema, await readJson(c));
    assertFree(input, id);
    db.prepare(
      `UPDATE customers SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, npwp = ?, credit_limit = ?, payment_terms = ?, price_tier = ?, note = ?, updated_at = ${NOW} WHERE id = ?`,
    ).run(...cols(input), id);
    return c.json(find(id));
  });

  app.post('/:id/archive', (c) => {
    const id = parseId(c.req.param('id'));
    if (mustFind(id).archived_at) throw new HttpError(409, 'Customer is already archived');
    db.prepare(`UPDATE customers SET archived_at = ${NOW}, updated_at = ${NOW} WHERE id = ?`).run(id);
    return c.json(find(id));
  });

  app.post('/:id/restore', (c) => {
    const id = parseId(c.req.param('id'));
    const s = mustFind(id);
    if (!s.archived_at) throw new HttpError(409, 'Customer is not archived');
    assertFree(customerInputSchema.parse(s as CustomerInput), id);
    db.prepare(`UPDATE customers SET archived_at = NULL, updated_at = ${NOW} WHERE id = ?`).run(id);
    return c.json(find(id));
  });

  return app;
}
