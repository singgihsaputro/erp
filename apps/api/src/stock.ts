import { Hono } from 'hono';
import {
  nextAverageCost,
  openingInputSchema,
  stockListQuerySchema,
  type Page,
  type StockHistory,
  type StockMoveRow,
  type StockRow,
} from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, parseId, readJson } from './http.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** Who may enter opening balances. Everyone signed in may read stock. */
export const STOCK_WRITERS = ['super_admin', 'owner', 'admin', 'warehouse'] as const;

export interface MoveInput {
  productId: number;
  warehouseId: number;
  qtyMilli: number;
  unitCost: number;
  sourceType: string;
  sourceId?: number | null;
  note?: string;
}

/**
 * Appends one row to the stock ledger. An inbound move re-averages the product's cost
 * (moving average over all warehouses); an outbound move is booked at the current average.
 * Other features post their stock through this function.
 */
export function postStockMove(db: Db, m: MoveInput): void {
  const p = db.prepare('SELECT cost FROM products WHERE id = ?').get(m.productId) as { cost: number } | undefined;
  if (!p) throw new HttpError(404, 'Product not found');
  const onHand = (db.prepare('SELECT COALESCE(SUM(qty_milli), 0) AS q FROM stock_moves WHERE product_id = ?').get(m.productId) as { q: number }).q;
  let unitCost = m.unitCost;
  if (m.qtyMilli > 0) {
    db.prepare(`UPDATE products SET cost = ?, updated_at = ${NOW} WHERE id = ?`).run(nextAverageCost(onHand, p.cost, m.qtyMilli, m.unitCost), m.productId);
  } else {
    unitCost = p.cost;
  }
  db.prepare(
    'INSERT INTO stock_moves (product_id, warehouse_id, qty_milli, unit_cost, source_type, source_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(m.productId, m.warehouseId, m.qtyMilli, unitCost, m.sourceType, m.sourceId ?? null, m.note ?? '');
}

export function stockRoutes(db: Db) {
  const app = new Hono();

  app.get('/', (c) => {
    const q = parse(stockListQuerySchema, c.req.query());
    const where = ['1 = 1'];
    const args: (string | number)[] = [];
    if (q.q) {
      where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)');
      const like = `%${q.q}%`;
      args.push(like, like, like);
    }
    if (q.warehouse_id) {
      where.push('m.warehouse_id = ?');
      args.push(q.warehouse_id);
    }
    const from = `FROM stock_moves m JOIN products p ON p.id = m.product_id JOIN warehouses w ON w.id = m.warehouse_id WHERE ${where.join(' AND ')}
      GROUP BY m.product_id, m.warehouse_id HAVING SUM(m.qty_milli) != 0`;
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 ${from})`).get(...args) as { n: number }).n;
    const rows = db
      .prepare(
        `SELECT p.id AS product_id, p.sku, p.name, p.base_unit, w.id AS warehouse_id, w.code AS warehouse_code,
           w.name AS warehouse_name, SUM(m.qty_milli) AS qty_milli, p.cost AS avg_cost,
           CAST(ROUND(SUM(m.qty_milli) * p.cost / 1000.0) AS INTEGER) AS value
         ${from} ORDER BY p.name COLLATE NOCASE, w.name COLLATE NOCASE LIMIT ? OFFSET ?`,
      )
      .all(...args, q.page_size, (q.page - 1) * q.page_size) as StockRow[];
    const body: Page<StockRow> = { items: rows, total, page: q.page, page_size: q.page_size };
    return c.json(body);
  });

  /** The full ledger of one product, oldest first, with running balance and moving-average cost. */
  app.get('/products/:id/moves', (c) => {
    const id = parseId(c.req.param('id'));
    const product = db.prepare('SELECT id, sku, name, base_unit, cost FROM products WHERE id = ?').get(id) as StockHistory['product'] | undefined;
    if (!product) throw new HttpError(404, 'Product not found');
    const wh = c.req.query('warehouse_id') ? parseId(c.req.query('warehouse_id') as string) : null;
    const rows = db
      .prepare(
        `SELECT m.id, m.created_at, m.warehouse_id, w.code AS warehouse_code, m.qty_milli, m.unit_cost, m.source_type, m.source_id, m.note
         FROM stock_moves m JOIN warehouses w ON w.id = m.warehouse_id WHERE m.product_id = ? ORDER BY m.id`,
      )
      .all(id) as Omit<StockMoveRow, 'balance_milli' | 'avg_cost_after'>[];
    let total = 0;
    let shown = 0;
    let avg = 0;
    const moves: StockMoveRow[] = [];
    for (const r of rows) {
      if (r.qty_milli > 0) avg = nextAverageCost(total, avg, r.qty_milli, r.unit_cost);
      total += r.qty_milli;
      if (wh !== null && r.warehouse_id !== wh) continue;
      shown += r.qty_milli;
      moves.push({ ...r, balance_milli: wh === null ? total : shown, avg_cost_after: avg });
    }
    const body: StockHistory = { product, moves };
    return c.json(body);
  });

  app.post('/opening', requireRole(...STOCK_WRITERS) as never, async (c) => {
    const input = parse(openingInputSchema, await readJson(c));
    const w = db.prepare('SELECT archived_at FROM warehouses WHERE id = ?').get(input.warehouse_id) as { archived_at: string | null } | undefined;
    if (!w) throw new HttpError(404, 'Warehouse not found');
    if (w.archived_at) throw new HttpError(409, 'Warehouse is archived');
    const seen = new Set<number>();
    for (const [i, l] of input.lines.entries()) {
      if (seen.has(l.product_id)) throw new HttpError(400, `Line ${i + 1}: product is listed twice`);
      seen.add(l.product_id);
      const p = db.prepare('SELECT archived_at FROM products WHERE id = ?').get(l.product_id) as { archived_at: string | null } | undefined;
      if (!p) throw new HttpError(404, `Line ${i + 1}: product not found`);
      if (p.archived_at) throw new HttpError(409, `Line ${i + 1}: product is archived`);
      if (db.prepare("SELECT 1 FROM stock_moves WHERE product_id = ? AND warehouse_id = ? AND source_type = 'opening'").get(l.product_id, input.warehouse_id)) {
        throw new HttpError(409, `Line ${i + 1}: this product already has an opening balance here; correct it with a stock adjustment`);
      }
    }
    db.transaction(() => {
      for (const l of input.lines) {
        postStockMove(db, {
          productId: l.product_id,
          warehouseId: input.warehouse_id,
          qtyMilli: l.qty_milli,
          unitCost: l.unit_cost,
          sourceType: 'opening',
          note: input.note || 'Opening balance',
        });
      }
    })();
    return c.json({ posted: input.lines.length }, 201);
  });

  return app;
}
