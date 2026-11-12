import { Hono } from 'hono';
import {
  transferInputSchema,
  transferListQuerySchema,
  type Page,
  type TransferDetail,
  type TransferInput,
  type TransferLine,
  type TransferSummary,
} from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, parseId, readJson, type AppEnv } from './http.js';
import { nextDocumentNumber } from './settings.js';
import { postStockMove } from './stock.js';

/** Who may send, receive and cancel transfers. Everyone signed in may read them. */
export const TRANSFER_WRITERS = ['super_admin', 'owner', 'admin', 'warehouse'] as const;

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const SUMMARY = `SELECT t.id, t.number, t.created_at, t.status, t.from_warehouse_id, wf.name AS from_warehouse_name,
    t.to_warehouse_id, wt.name AS to_warehouse_name, t.note, u.name AS created_by_name, t.received_at, t.cancelled_at,
    (SELECT COUNT(*) FROM stock_transfer_lines l WHERE l.transfer_id = t.id) AS line_count,
    (SELECT COALESCE(SUM(CAST(ROUND(l.qty_milli * l.unit_cost / 1000.0) AS INTEGER)), 0) FROM stock_transfer_lines l WHERE l.transfer_id = t.id) AS value
  FROM stock_transfers t JOIN warehouses wf ON wf.id = t.from_warehouse_id JOIN warehouses wt ON wt.id = t.to_warehouse_id JOIN users u ON u.id = t.created_by`;

function activeWarehouse(db: Db, id: number, label: string): void {
  const w = db.prepare('SELECT archived_at FROM warehouses WHERE id = ?').get(id) as { archived_at: string | null } | undefined;
  if (!w) throw new HttpError(404, `${label} warehouse not found`);
  if (w.archived_at) throw new HttpError(409, `${label} warehouse is archived`);
}

/** Validates and sends a transfer: the stock leaves the source now and is in transit until received. */
export function sendTransfer(db: Db, input: TransferInput & { note?: string }, userId: number): number {
  activeWarehouse(db, input.from_warehouse_id, 'Source');
  activeWarehouse(db, input.to_warehouse_id, 'Destination');
  const seen = new Set<number>();
  for (const [i, l] of input.lines.entries()) {
    if (seen.has(l.product_id)) throw new HttpError(400, `Line ${i + 1}: product is listed twice`);
    seen.add(l.product_id);
    const p = db.prepare('SELECT name, archived_at FROM products WHERE id = ?').get(l.product_id) as { name: string; archived_at: string | null } | undefined;
    if (!p) throw new HttpError(404, `Line ${i + 1}: product not found`);
    if (p.archived_at) throw new HttpError(409, `Line ${i + 1}: product is archived`);
    const onHand = (db.prepare('SELECT COALESCE(SUM(qty_milli), 0) AS q FROM stock_moves WHERE product_id = ? AND warehouse_id = ?').get(l.product_id, input.from_warehouse_id) as { q: number }).q;
    if (onHand < l.qty_milli) throw new HttpError(409, `Line ${i + 1}: only ${onHand / 1000} of ${p.name} on hand in the source warehouse, cannot send ${l.qty_milli / 1000}`);
  }
  return db.transaction(() => {
    const number = nextDocumentNumber(db, 'stock_transfer');
    const id = Number(
      db.prepare('INSERT INTO stock_transfers (number, from_warehouse_id, to_warehouse_id, note, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(number, input.from_warehouse_id, input.to_warehouse_id, input.note ?? '', userId).lastInsertRowid,
    );
    for (const l of input.lines) {
      const cost = (db.prepare('SELECT cost FROM products WHERE id = ?').get(l.product_id) as { cost: number }).cost;
      postStockMove(db, {
        productId: l.product_id, warehouseId: input.from_warehouse_id, qtyMilli: -l.qty_milli, unitCost: cost,
        sourceType: 'stock_transfer_out', sourceId: id, note: `${number} · sent`,
      });
      db.prepare('INSERT INTO stock_transfer_lines (transfer_id, product_id, qty_milli, unit_cost) VALUES (?, ?, ?, ?)').run(id, l.product_id, l.qty_milli, cost);
    }
    return id;
  })();
}

/** Closes an in-transit transfer: `received` books the stock into the destination, `cancelled` back into the source. */
function settle(db: Db, id: number, outcome: 'received' | 'cancelled', userId: number): void {
  const t = db.prepare('SELECT number, status, from_warehouse_id, to_warehouse_id FROM stock_transfers WHERE id = ?').get(id) as
    | { number: string; status: string; from_warehouse_id: number; to_warehouse_id: number }
    | undefined;
  if (!t) throw new HttpError(404, 'Transfer not found');
  if (t.status !== 'in_transit') throw new HttpError(409, `Transfer ${t.number} is already ${t.status}`);
  if (outcome === 'received') activeWarehouse(db, t.to_warehouse_id, 'Destination');
  const lines = db.prepare('SELECT product_id, qty_milli, unit_cost FROM stock_transfer_lines WHERE transfer_id = ? ORDER BY id').all(id) as { product_id: number; qty_milli: number; unit_cost: number }[];
  db.transaction(() => {
    for (const l of lines) {
      postStockMove(db, {
        productId: l.product_id,
        warehouseId: outcome === 'received' ? t.to_warehouse_id : t.from_warehouse_id,
        qtyMilli: l.qty_milli,
        unitCost: l.unit_cost,
        sourceType: outcome === 'received' ? 'stock_transfer_in' : 'stock_transfer_cancel',
        sourceId: id,
        note: `${t.number} · ${outcome}`,
      });
    }
    if (outcome === 'received') {
      db.prepare(`UPDATE stock_transfers SET status = 'received', received_by = ?, received_at = ${NOW}, updated_at = ${NOW} WHERE id = ?`).run(userId, id);
    } else {
      db.prepare(`UPDATE stock_transfers SET status = 'cancelled', cancelled_at = ${NOW}, updated_at = ${NOW} WHERE id = ?`).run(id);
    }
  })();
}


export function transferRoutes(db: Db) {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => {
    const q = parse(transferListQuerySchema, c.req.query());
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q.status) { where.push('t.status = ?'); args.push(q.status); }
    if (q.warehouse_id) { where.push('(t.from_warehouse_id = ? OR t.to_warehouse_id = ?)'); args.push(q.warehouse_id, q.warehouse_id); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM stock_transfers t ${clause}`).get(...args) as { n: number }).n;
    const items = db.prepare(`${SUMMARY} ${clause} ORDER BY t.id DESC LIMIT ? OFFSET ?`).all(...args, q.page_size, (q.page - 1) * q.page_size) as TransferSummary[];
    const body: Page<TransferSummary> = { items, total, page: q.page, page_size: q.page_size };
    return c.json(body);
  });

  const detail = (id: number): TransferDetail => {
    const head = db.prepare(`${SUMMARY} WHERE t.id = ?`).get(id) as TransferSummary | undefined;
    if (!head) throw new HttpError(404, 'Transfer not found');
    const lines = db
      .prepare(
        `SELECT l.product_id, p.sku, p.name, p.base_unit, l.qty_milli, l.unit_cost
         FROM stock_transfer_lines l JOIN products p ON p.id = l.product_id WHERE l.transfer_id = ? ORDER BY l.id`,
      )
      .all(id) as TransferLine[];
    return { ...head, lines };
  };

  app.get('/:id', (c) => c.json(detail(parseId(c.req.param('id')))));

  app.post('/', requireRole(...TRANSFER_WRITERS) as never, async (c) => {
    const input = parse(transferInputSchema, await readJson(c));
    return c.json(detail(sendTransfer(db, input, c.get('user').id)), 201);
  });

  app.post('/:id/receive', requireRole(...TRANSFER_WRITERS) as never, (c) => {
    const id = parseId(c.req.param('id'));
    settle(db, id, 'received', c.get('user').id);
    return c.json(detail(id));
  });

  app.post('/:id/cancel', requireRole(...TRANSFER_WRITERS) as never, (c) => {
    const id = parseId(c.req.param('id'));
    settle(db, id, 'cancelled', c.get('user').id);
    return c.json(detail(id));
  });

  return app;
}

/** Receives a transfer without going through HTTP (used by the demo seed). */
export function receiveTransfer(db: Db, id: number, userId: number): void {
  settle(db, id, 'received', userId);
}
