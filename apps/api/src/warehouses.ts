import { Hono } from 'hono';
import { warehouseInputSchema, type Warehouse, type WarehouseStockRow } from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, parseId, readJson } from './http.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const SELECT = `
  SELECT w.id, w.code, w.name, w.address, w.is_default, w.archived_at, w.created_at, w.updated_at,
    (SELECT COUNT(*) FROM (SELECT 1 FROM stock_moves m WHERE m.warehouse_id = w.id
       GROUP BY m.product_id HAVING SUM(m.qty_milli) != 0)) AS product_count,
    COALESCE((SELECT SUM(m.qty_milli) FROM stock_moves m WHERE m.warehouse_id = w.id), 0) AS stock_milli,
    COALESCE((SELECT SUM(m.qty_milli * m.unit_cost / 1000) FROM stock_moves m WHERE m.warehouse_id = w.id), 0) AS stock_value,
    (SELECT COUNT(*) FROM stock_moves m WHERE m.warehouse_id = w.id) AS move_count
  FROM warehouses w`;

type Row = Omit<Warehouse, 'is_default'> & { is_default: number };
const shape = (r: Row): Warehouse => ({ ...r, is_default: r.is_default === 1, stock_value: Math.round(r.stock_value) });

/** Who may create, edit, archive warehouses. The web sidebar shows the page to everyone. */
export const WAREHOUSE_MANAGERS = ['super_admin', 'owner', 'admin'] as const;

export function warehouseRoutes(db: Db) {
  const app = new Hono();
  // Everyone signed in may look; only managers change warehouses.
  const manage = requireRole(...WAREHOUSE_MANAGERS);
  app.use('*', (c, next) => (c.req.method === 'GET' ? next() : manage(c as never, next)));
  const find = (id: number) => {
    const r = db.prepare(`${SELECT} WHERE w.id = ?`).get(id) as Row | undefined;
    return r ? shape(r) : undefined;
  };
  const mustFind = (id: number) => {
    const w = find(id);
    if (!w) throw new HttpError(404, 'Warehouse not found');
    return w;
  };
  const assertCodeFree = (code: string, exceptId = 0) => {
    if (db.prepare('SELECT 1 FROM warehouses WHERE code = ? AND id != ?').get(code, exceptId)) {
      throw new HttpError(409, `Warehouse code ${code} already exists`);
    }
  };

  app.get('/', (c) => {
    const archived = c.req.query('archived') === '1';
    const rows = db
      .prepare(`${SELECT} WHERE ${archived ? 'w.archived_at IS NOT NULL' : 'w.archived_at IS NULL'} ORDER BY w.is_default DESC, w.name COLLATE NOCASE`)
      .all() as Row[];
    return c.json(rows.map(shape));
  });

  app.get('/:id', (c) => c.json(mustFind(parseId(c.req.param('id')))));

  /** On-hand per product in this warehouse (sum of its ledger moves). */
  app.get('/:id/stock', (c) => {
    const id = parseId(c.req.param('id'));
    mustFind(id);
    const rows = db
      .prepare(
        `SELECT p.id AS product_id, p.sku, p.name, p.base_unit, SUM(m.qty_milli) AS qty_milli
         FROM stock_moves m JOIN products p ON p.id = m.product_id
         WHERE m.warehouse_id = ? GROUP BY p.id HAVING SUM(m.qty_milli) != 0
         ORDER BY p.name COLLATE NOCASE`,
      )
      .all(id) as WarehouseStockRow[];
    return c.json(rows);
  });

  app.post('/', async (c) => {
    const input = parse(warehouseInputSchema, await readJson(c));
    assertCodeFree(input.code);
    const r = db
      .prepare('INSERT INTO warehouses (code, name, address) VALUES (?, ?, ?)')
      .run(input.code, input.name, input.address);
    return c.json(find(Number(r.lastInsertRowid)), 201);
  });

  app.put('/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    const existing = mustFind(id);
    const input = parse(warehouseInputSchema, await readJson(c));
    assertCodeFree(input.code, id);
    if (input.code.toLowerCase() !== existing.code.toLowerCase() && existing.move_count > 0) {
      throw new HttpError(409, 'The code cannot change once the warehouse has stock movements');
    }
    db.prepare(`UPDATE warehouses SET code = ?, name = ?, address = ?, updated_at = ${NOW} WHERE id = ?`).run(
      input.code,
      input.name,
      input.address,
      id,
    );
    return c.json(find(id));
  });

  app.post('/:id/make-default', (c) => {
    const id = parseId(c.req.param('id'));
    const w = mustFind(id);
    if (w.archived_at) throw new HttpError(409, 'An archived warehouse cannot be the default');
    db.transaction(() => {
      db.prepare(`UPDATE warehouses SET is_default = 0, updated_at = ${NOW} WHERE is_default = 1`).run();
      db.prepare(`UPDATE warehouses SET is_default = 1, updated_at = ${NOW} WHERE id = ?`).run(id);
    })();
    return c.json(find(id));
  });

  app.post('/:id/archive', (c) => {
    const id = parseId(c.req.param('id'));
    const w = mustFind(id);
    if (w.archived_at) throw new HttpError(409, 'Warehouse is already archived');
    if (w.is_default) throw new HttpError(409, 'Make another warehouse the default before archiving this one');
    if (w.product_count > 0) throw new HttpError(409, `${w.product_count} product(s) still have stock here; move it out first`);
    db.prepare(`UPDATE warehouses SET archived_at = ${NOW}, updated_at = ${NOW} WHERE id = ?`).run(id);
    return c.json(find(id));
  });

  app.post('/:id/restore', (c) => {
    const id = parseId(c.req.param('id'));
    const w = mustFind(id);
    if (!w.archived_at) throw new HttpError(409, 'Warehouse is not archived');
    db.prepare(`UPDATE warehouses SET archived_at = NULL, updated_at = ${NOW} WHERE id = ?`).run(id);
    return c.json(find(id));
  });

  return app;
}
