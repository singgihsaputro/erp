import { Hono } from 'hono';
import { reorderListQuerySchema, reorderPointInputSchema, type ReorderList, type ReorderRow } from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, parseId, readJson } from './http.js';

/** Who may set and remove reorder points. Everyone signed in may read them. */
export const REORDER_WRITERS = ['super_admin', 'owner', 'admin', 'warehouse'] as const;

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const SELECT = `SELECT r.id, r.product_id, p.sku, p.name, p.base_unit, r.warehouse_id, w.name AS warehouse_name, r.min_qty_milli,
    COALESCE((SELECT SUM(m.qty_milli) FROM stock_moves m WHERE m.product_id = r.product_id AND m.warehouse_id = r.warehouse_id), 0) AS on_hand_milli
  FROM reorder_points r JOIN products p ON p.id = r.product_id JOIN warehouses w ON w.id = r.warehouse_id`;

type Raw = Omit<ReorderRow, 'shortfall_milli' | 'below'>;
const shape = (r: Raw): ReorderRow => ({
  ...r,
  shortfall_milli: Math.max(0, r.min_qty_milli - r.on_hand_milli),
  below: r.on_hand_milli < r.min_qty_milli,
});

export function reorderRoutes(db: Db) {
  const app = new Hono();

  app.get('/', (c) => {
    const q = parse(reorderListQuerySchema, c.req.query());
    const where = ['p.archived_at IS NULL', 'w.archived_at IS NULL'];
    const args: (string | number)[] = [];
    if (q.q) {
      where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)');
      const like = `%${q.q}%`;
      args.push(like, like, like);
    }
    if (q.warehouse_id) { where.push('r.warehouse_id = ?'); args.push(q.warehouse_id); }
    const clause = `WHERE ${where.join(' AND ')}`;
    // Rows are few (one per product and warehouse that has a minimum), so filter on the shaped rows.
    const all = (db.prepare(`${SELECT} ${clause} ORDER BY p.name COLLATE NOCASE, w.name COLLATE NOCASE`).all(...args) as Raw[]).map(shape);
    const belowCount = all.filter((r) => r.below).length;
    const onlyBelow = q.below === '1' || q.below === 'true';
    const rows = onlyBelow ? all.filter((r) => r.below) : all;
    if (onlyBelow) rows.sort((a, b) => a.on_hand_milli / a.min_qty_milli - b.on_hand_milli / b.min_qty_milli);
    const body: ReorderList = {
      items: rows.slice((q.page - 1) * q.page_size, q.page * q.page_size),
      total: rows.length,
      page: q.page,
      page_size: q.page_size,
      below_count: belowCount,
    };
    return c.json(body);
  });

  /** Sets the minimum for a product in a warehouse, creating or replacing it. */
  app.put('/', requireRole(...REORDER_WRITERS) as never, async (c) => {
    const input = parse(reorderPointInputSchema, await readJson(c));
    const p = db.prepare('SELECT archived_at FROM products WHERE id = ?').get(input.product_id) as { archived_at: string | null } | undefined;
    if (!p) throw new HttpError(404, 'Product not found');
    if (p.archived_at) throw new HttpError(409, 'Product is archived');
    const w = db.prepare('SELECT archived_at FROM warehouses WHERE id = ?').get(input.warehouse_id) as { archived_at: string | null } | undefined;
    if (!w) throw new HttpError(404, 'Warehouse not found');
    if (w.archived_at) throw new HttpError(409, 'Warehouse is archived');
    const existing = db.prepare('SELECT id FROM reorder_points WHERE product_id = ? AND warehouse_id = ?').get(input.product_id, input.warehouse_id) as { id: number } | undefined;
    let id: number;
    if (existing) {
      id = existing.id;
      db.prepare(`UPDATE reorder_points SET min_qty_milli = ?, updated_at = ${NOW} WHERE id = ?`).run(input.min_qty_milli, id);
    } else {
      id = Number(db.prepare('INSERT INTO reorder_points (product_id, warehouse_id, min_qty_milli) VALUES (?, ?, ?)').run(input.product_id, input.warehouse_id, input.min_qty_milli).lastInsertRowid);
    }
    return c.json(shape(db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as Raw), existing ? 200 : 201);
  });

  app.delete('/:id', requireRole(...REORDER_WRITERS) as never, (c) => {
    const id = parseId(c.req.param('id'));
    if (db.prepare('DELETE FROM reorder_points WHERE id = ?').run(id).changes === 0) throw new HttpError(404, 'Reorder point not found');
    return c.json({ deleted: true });
  });

  return app;
}
