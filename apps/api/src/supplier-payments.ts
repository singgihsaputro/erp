import { Hono } from 'hono';
import {
  formatRupiah,
  spInputSchema,
  spListQuerySchema,
  type AgingBucket,
  type AgingReport,
  type AgingRow,
  type Page,
  type SpAllocation,
  type SpDetail,
  type SpOpenInvoice,
  type SpSummary,
} from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, parseId, readJson, type AppEnv } from './http.js';
import { jakartaToday } from './batches.js';
import { nextDocumentNumber } from './settings.js';
import { SI_ROLES } from './supplier-invoices.js';

type Input = ReturnType<typeof spInputSchema.parse>;

const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
const daysOverdue = (due: string, today: string) => Math.max(0, dayNumber(today) - dayNumber(due));

function bucketOf(days: number): AgingBucket {
  if (days <= 0) return 'current';
  if (days <= 30) return 'd1_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd90_plus';
}

const emptyBuckets = (): Record<AgingBucket, number> => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 });

/** Posts a payment against invoices of one supplier. Also used by the demo seed. */
export function paySupplier(db: Db, input: Input, userId: number): number {
  const sup = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(input.supplier_id);
  if (!sup) throw new HttpError(404, 'Supplier not found');
  const seen = new Set<number>();
  for (const [i, a] of input.allocations.entries()) {
    if (seen.has(a.invoice_id)) throw new HttpError(400, `Line ${i + 1}: invoice is listed twice`);
    seen.add(a.invoice_id);
  }
  return db.transaction(() => {
    const total = input.allocations.reduce((s, a) => s + a.amount, 0);
    for (const [i, a] of input.allocations.entries()) {
      const inv = db
        .prepare('SELECT number, supplier_id, invoice_date, total, amount_paid FROM supplier_invoices WHERE id = ?')
        .get(a.invoice_id) as { number: string; supplier_id: number; invoice_date: string; total: number; amount_paid: number } | undefined;
      if (!inv) throw new HttpError(404, `Line ${i + 1}: invoice not found`);
      if (inv.supplier_id !== input.supplier_id) throw new HttpError(400, `Line ${i + 1}: ${inv.number} belongs to another supplier`);
      if (input.payment_date < inv.invoice_date) throw new HttpError(400, `Line ${i + 1}: payment date is before the date of ${inv.number}`);
      const outstanding = inv.total - inv.amount_paid;
      if (a.amount > outstanding) {
        throw new HttpError(409, `${inv.number}: cannot pay ${formatRupiah(a.amount)}, only ${formatRupiah(outstanding)} is outstanding`);
      }
    }
    const number = nextDocumentNumber(db, 'payment');
    const id = Number(
      db
        .prepare('INSERT INTO supplier_payments (number, supplier_id, payment_date, method, reference, note, total, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(number, input.supplier_id, input.payment_date, input.method, input.reference, input.note, total, userId).lastInsertRowid,
    );
    const add = db.prepare('INSERT INTO supplier_payment_allocations (payment_id, invoice_id, amount) VALUES (?, ?, ?)');
    const bump = db.prepare("UPDATE supplier_invoices SET amount_paid = amount_paid + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?");
    for (const a of input.allocations) {
      add.run(id, a.invoice_id, a.amount);
      bump.run(a.amount, a.invoice_id);
    }
    return id;
  })();
}

export function supplierPaymentRoutes(db: Db) {
  const app = new Hono<AppEnv>();
  app.use('*', requireRole(...SI_ROLES) as never);

  const SUMMARY = `SELECT p.id, p.number, p.supplier_id, s.name AS supplier_name, p.payment_date, p.method, p.reference, p.total,
      (SELECT COUNT(*) FROM supplier_payment_allocations a WHERE a.payment_id = p.id) AS invoice_count, p.created_at
    FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id`;

  app.get('/', (c) => {
    const q = parse(spListQuerySchema, c.req.query());
    const clause = q.supplier_id ? 'WHERE p.supplier_id = ?' : '';
    const args = q.supplier_id ? [q.supplier_id] : [];
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM supplier_payments p ${clause}`).get(...args) as { n: number }).n;
    const items = db.prepare(`${SUMMARY} ${clause} ORDER BY p.id DESC LIMIT ? OFFSET ?`).all(...args, q.page_size, (q.page - 1) * q.page_size) as SpSummary[];
    const body: Page<SpSummary> = { items, total, page: q.page, page_size: q.page_size };
    return c.json(body);
  });

  /** Unpaid invoices of one supplier, oldest due date first. */
  app.get('/open-invoices', (c) => {
    const supplierId = parseId(c.req.query('supplier_id') ?? '');
    const today = jakartaToday();
    const rows = db
      .prepare(
        `SELECT id, number, supplier_invoice_no, invoice_date, due_date, total, total - amount_paid AS outstanding
         FROM supplier_invoices WHERE supplier_id = ? AND total - amount_paid > 0 ORDER BY due_date, id`,
      )
      .all(supplierId) as Omit<SpOpenInvoice, 'days_overdue'>[];
    return c.json(rows.map((r): SpOpenInvoice => ({ ...r, days_overdue: daysOverdue(r.due_date, today) })));
  });

  /** Accounts payable aging: what is owed per supplier, by how long it has been overdue. */
  app.get('/aging', (c) => {
    const today = jakartaToday();
    const rows = db
      .prepare(
        `SELECT i.supplier_id, s.name AS supplier_name, i.due_date, i.total - i.amount_paid AS outstanding
         FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.total - i.amount_paid > 0 ORDER BY s.name, i.due_date`,
      )
      .all() as { supplier_id: number; supplier_name: string; due_date: string; outstanding: number }[];
    const bySupplier = new Map<number, AgingRow>();
    const totals = { ...emptyBuckets(), total: 0 };
    for (const r of rows) {
      let row = bySupplier.get(r.supplier_id);
      if (!row) {
        row = { supplier_id: r.supplier_id, supplier_name: r.supplier_name, invoice_count: 0, total: 0, buckets: emptyBuckets() };
        bySupplier.set(r.supplier_id, row);
      }
      const b = bucketOf(daysOverdue(r.due_date, today));
      row.invoice_count++;
      row.total += r.outstanding;
      row.buckets[b] += r.outstanding;
      totals[b] += r.outstanding;
      totals.total += r.outstanding;
    }
    const body: AgingReport = { as_of: today, rows: [...bySupplier.values()], totals };
    return c.json(body);
  });

  const detail = (id: number): SpDetail => {
    const head = db.prepare(`${SUMMARY} WHERE p.id = ?`).get(id) as SpSummary | undefined;
    if (!head) throw new HttpError(404, 'Payment not found');
    const extra = db
      .prepare('SELECT p.note, u.name AS created_by_name FROM supplier_payments p JOIN users u ON u.id = p.created_by WHERE p.id = ?')
      .get(id) as Pick<SpDetail, 'note' | 'created_by_name'>;
    const allocations = db
      .prepare(
        `SELECT a.invoice_id, i.number AS invoice_number, i.supplier_invoice_no, a.amount
         FROM supplier_payment_allocations a JOIN supplier_invoices i ON i.id = a.invoice_id WHERE a.payment_id = ? ORDER BY a.id`,
      )
      .all(id) as SpAllocation[];
    return { ...head, ...extra, allocations };
  };

  app.get('/:id', (c) => c.json(detail(parseId(c.req.param('id')))));

  app.post('/', async (c) => {
    const input = parse(spInputSchema, await readJson(c));
    return c.json(detail(paySupplier(db, input, c.get('user').id)), 201);
  });

  return app;
}
