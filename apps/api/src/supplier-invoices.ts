import { Hono } from 'hono';
import {
  formatRupiah,
  siInputSchema,
  siListQuerySchema,
  type InvoiceData,
  type Page,
  type SiDetail,
  type SiExtractionOption,
  type SiLine,
  type SiMatchWarning,
  type SiPayableSummary,
  type SiPrefill,
  type SiReceiptOption,
  type SiSummary,
} from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, parseId, readJson, type AppEnv } from './http.js';
import { jakartaToday } from './batches.js';
import { nextDocumentNumber } from './settings.js';

/** Who may record supplier invoices and see accounts payable. */
export const SI_ROLES = ['super_admin', 'owner', 'admin'] as const;

type Input = ReturnType<typeof siInputSchema.parse>;

const TERM_DAYS: Record<string, number> = { cash: 0, net_14: 14, net_30: 30 };
const qty = (milli: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(milli / 1000);

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const SUMMARY = `SELECT i.id, i.number, i.supplier_invoice_no, i.supplier_id, s.name AS supplier_name, i.receipt_id, r.number AS receipt_number,
    o.number AS order_number, i.invoice_date, i.due_date, i.dpp, i.ppn, i.total, i.amount_paid, i.amount_credited, i.total - i.amount_paid - i.amount_credited AS outstanding, i.created_at
  FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id JOIN goods_receipts r ON r.id = i.receipt_id
  JOIN purchase_orders o ON o.id = i.order_id`;

const statusOf = (outstanding: number, due: string, today: string): SiSummary['status'] =>
  outstanding <= 0 ? 'paid' : due < today ? 'overdue' : 'open';

/** Three-way match: the invoice against the goods receipt (quantity) and the order price it booked. */
function matchWarnings(db: Db, invoiceId: number): SiMatchWarning[] {
  const inv = db.prepare('SELECT receipt_id, total, stated_total FROM supplier_invoices WHERE id = ?').get(invoiceId) as {
    receipt_id: number; total: number; stated_total: number | null;
  };
  const rows = db
    .prepare(
      `SELECT COALESCE(il.product_id, rl.product_id) AS product_id, p.name, il.qty_milli AS billed, il.unit_cost AS billed_cost,
         rl.qty_milli AS received, rl.unit_cost AS received_cost
       FROM (SELECT * FROM supplier_invoice_lines WHERE invoice_id = ?) il
       LEFT JOIN goods_receipt_lines rl ON rl.product_id = il.product_id AND rl.receipt_id = ?
       JOIN products p ON p.id = il.product_id
       UNION ALL
       SELECT rl.product_id, p.name, NULL, NULL, rl.qty_milli, rl.unit_cost
       FROM goods_receipt_lines rl JOIN products p ON p.id = rl.product_id
       WHERE rl.receipt_id = ? AND rl.product_id NOT IN (SELECT product_id FROM supplier_invoice_lines WHERE invoice_id = ?)`,
    )
    .all(invoiceId, inv.receipt_id, inv.receipt_id, invoiceId) as {
    product_id: number; name: string; billed: number | null; billed_cost: number | null; received: number | null; received_cost: number | null;
  }[];
  const out: SiMatchWarning[] = [];
  for (const r of rows) {
    if (r.billed === null) {
      out.push({ product_id: r.product_id, kind: 'not_invoiced', message: `${r.name}: ${qty(r.received!)} received but not on the invoice` });
      continue;
    }
    if (r.received === null) {
      out.push({ product_id: r.product_id, kind: 'qty', message: `${r.name}: invoiced ${qty(r.billed)} but none was received` });
      continue;
    }
    if (r.billed !== r.received) {
      out.push({ product_id: r.product_id, kind: 'qty', message: `${r.name}: invoiced ${qty(r.billed)} but ${qty(r.received)} received` });
    }
    if (r.billed_cost !== r.received_cost) {
      out.push({ product_id: r.product_id, kind: 'price', message: `${r.name}: invoiced at ${formatRupiah(r.billed_cost!)} but the order price is ${formatRupiah(r.received_cost!)}` });
    }
  }
  if (inv.stated_total !== null && inv.stated_total !== inv.total) {
    out.push({ product_id: null, kind: 'total', message: `The supplier's total ${formatRupiah(inv.stated_total)} differs from the lines plus PPN, ${formatRupiah(inv.total)}` });
  }
  return out;
}

/** Records a supplier invoice against a goods receipt. Also used by the demo seed. */
export function createSupplierInvoice(db: Db, input: Input, userId: number): number {
  const r = db
    .prepare(
      `SELECT r.id, r.number, r.order_id, r.receipt_date, o.supplier_id, o.ppn_rate_bp, s.payment_terms
       FROM goods_receipts r JOIN purchase_orders o ON o.id = r.order_id JOIN suppliers s ON s.id = o.supplier_id WHERE r.id = ?`,
    )
    .get(input.receipt_id) as { id: number; number: string; order_id: number; receipt_date: string; supplier_id: number; ppn_rate_bp: number; payment_terms: string } | undefined;
  if (!r) throw new HttpError(404, 'Goods receipt not found');
  const already = db.prepare('SELECT number FROM supplier_invoices WHERE receipt_id = ?').get(r.id) as { number: string } | undefined;
  if (already) throw new HttpError(409, `${r.number} is already invoiced as ${already.number}`);
  if (input.invoice_date < r.receipt_date) throw new HttpError(400, 'Invoice date cannot be before the goods receipt date');
  const dup = db
    .prepare('SELECT number FROM supplier_invoices WHERE supplier_id = ? AND supplier_invoice_no = ? COLLATE NOCASE')
    .get(r.supplier_id, input.supplier_invoice_no) as { number: string } | undefined;
  if (dup) throw new HttpError(409, `This supplier's invoice ${input.supplier_invoice_no} is already recorded as ${dup.number}`);
  if (input.extraction_id) {
    const x = db.prepare('SELECT status FROM invoice_extractions WHERE id = ?').get(input.extraction_id) as { status: string } | undefined;
    if (!x) throw new HttpError(404, 'Invoice in the inbox not found');
    if (x.status !== 'confirmed') throw new HttpError(409, 'Only a confirmed invoice from the inbox can be used');
    const used = db.prepare('SELECT number FROM supplier_invoices WHERE extraction_id = ?').get(input.extraction_id) as { number: string } | undefined;
    if (used) throw new HttpError(409, `That inbox invoice is already recorded as ${used.number}`);
  }
  const seen = new Set<number>();
  for (const [i, l] of input.lines.entries()) {
    if (seen.has(l.product_id)) throw new HttpError(400, `Line ${i + 1}: product is listed twice`);
    seen.add(l.product_id);
    if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(l.product_id)) throw new HttpError(404, `Line ${i + 1}: product not found`);
    if (!db.prepare('SELECT 1 FROM goods_receipt_lines WHERE receipt_id = ? AND product_id = ?').get(r.id, l.product_id)) {
      throw new HttpError(400, `Line ${i + 1}: product is not on ${r.number}`);
    }
  }
  const dpp = input.lines.reduce((s, l) => s + Math.round((l.qty_milli * l.unit_cost) / 1000), 0);
  const ppn = Math.round((dpp * r.ppn_rate_bp) / 10_000);
  const due = input.due_date ?? addDays(input.invoice_date, TERM_DAYS[r.payment_terms] ?? 0);
  return db.transaction(() => {
    const number = nextDocumentNumber(db, 'supplier_invoice');
    const id = Number(
      db
        .prepare(
          `INSERT INTO supplier_invoices (number, supplier_invoice_no, supplier_id, receipt_id, order_id, extraction_id, invoice_date, due_date, note,
             ppn_rate_bp, dpp, ppn, total, stated_total, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(number, input.supplier_invoice_no, r.supplier_id, r.id, r.order_id, input.extraction_id ?? null, input.invoice_date, due, input.note,
          r.ppn_rate_bp, dpp, ppn, dpp + ppn, input.stated_total ?? null, userId).lastInsertRowid,
    );
    const add = db.prepare('INSERT INTO supplier_invoice_lines (invoice_id, product_id, qty_milli, unit_cost) VALUES (?, ?, ?, ?)');
    for (const l of input.lines) add.run(id, l.product_id, l.qty_milli, l.unit_cost);
    return id;
  })();
}

export function supplierInvoiceRoutes(db: Db) {
  const app = new Hono<AppEnv>();
  app.use('*', requireRole(...SI_ROLES) as never);

  const summarize = (rows: Omit<SiSummary, 'status' | 'warning_count'>[]): SiSummary[] => {
    const today = jakartaToday();
    return rows.map((r) => ({ ...r, status: statusOf(r.outstanding, r.due_date, today), warning_count: matchWarnings(db, r.id).length }));
  };

  app.get('/', (c) => {
    const q = parse(siListQuerySchema, c.req.query());
    const today = jakartaToday();
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.status === 'paid') where.push('i.total - i.amount_paid - i.amount_credited <= 0');
    if (q.status === 'open') { where.push('i.total - i.amount_paid - i.amount_credited > 0 AND i.due_date >= ?'); args.push(today); }
    if (q.status === 'overdue') { where.push('i.total - i.amount_paid - i.amount_credited > 0 AND i.due_date < ?'); args.push(today); }
    if (q.supplier_id) { where.push('i.supplier_id = ?'); args.push(q.supplier_id); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM supplier_invoices i ${clause}`).get(...args) as { n: number }).n;
    const rows = db.prepare(`${SUMMARY} ${clause} ORDER BY i.id DESC LIMIT ? OFFSET ?`).all(...args, q.page_size, (q.page - 1) * q.page_size) as Omit<SiSummary, 'status' | 'warning_count'>[];
    const body: Page<SiSummary> = { items: summarize(rows), total, page: q.page, page_size: q.page_size };
    return c.json(body);
  });

  app.get('/payable', (c) => {
    const today = jakartaToday();
    const r = db
      .prepare(
        `SELECT COUNT(*) AS open_count, COALESCE(SUM(total - amount_paid - amount_credited), 0) AS outstanding,
           COALESCE(SUM(CASE WHEN due_date < ? THEN 1 ELSE 0 END), 0) AS overdue_count,
           COALESCE(SUM(CASE WHEN due_date < ? THEN total - amount_paid - amount_credited ELSE 0 END), 0) AS overdue_outstanding
         FROM supplier_invoices WHERE total - amount_paid - amount_credited > 0`,
      )
      .get(today, today) as SiPayableSummary;
    return c.json(r);
  });

  app.get('/receipts', (c) => {
    const rows = db
      .prepare(
        `SELECT r.id, r.number, o.number AS order_number, o.supplier_id, s.name AS supplier_name, r.receipt_date,
           (SELECT COALESCE(SUM(CAST(ROUND(l.qty_milli * l.unit_cost / 1000.0) AS INTEGER)), 0) FROM goods_receipt_lines l WHERE l.receipt_id = r.id) AS value
         FROM goods_receipts r JOIN purchase_orders o ON o.id = r.order_id JOIN suppliers s ON s.id = o.supplier_id
         WHERE r.id NOT IN (SELECT receipt_id FROM supplier_invoices) ORDER BY r.id DESC LIMIT 200`,
      )
      .all() as SiReceiptOption[];
    return c.json(rows);
  });

  app.get('/extractions', (c) => {
    const rows = db
      .prepare(
        `SELECT id, file_name, supplier_name, invoice_number, invoice_date, total FROM invoice_extractions
         WHERE status = 'confirmed' AND id NOT IN (SELECT extraction_id FROM supplier_invoices WHERE extraction_id IS NOT NULL)
         ORDER BY id DESC LIMIT 200`,
      )
      .all() as SiExtractionOption[];
    return c.json(rows);
  });

  /** Starting values for the form from a confirmed inbox PDF: the supplier, the likely receipt and the lines. */
  app.get('/prefill/:extractionId', (c) => {
    const id = parseId(c.req.param('extractionId'));
    const x = db.prepare('SELECT status, data_json FROM invoice_extractions WHERE id = ?').get(id) as { status: string; data_json: string } | undefined;
    if (!x) throw new HttpError(404, 'Invoice in the inbox not found');
    if (x.status !== 'confirmed') throw new HttpError(409, 'Only a confirmed invoice from the inbox can be used');
    const used = db.prepare('SELECT number FROM supplier_invoices WHERE extraction_id = ?').get(id) as { number: string } | undefined;
    if (used) throw new HttpError(409, `That inbox invoice is already recorded as ${used.number}`);
    const data = JSON.parse(x.data_json) as InvoiceData;
    const sup = (data.supplier_npwp
      ? (db.prepare("SELECT id FROM suppliers WHERE npwp = ? AND npwp != '' AND archived_at IS NULL").get(data.supplier_npwp) as { id: number } | undefined)
      : undefined) ??
      (data.supplier_name
        ? (db.prepare('SELECT id FROM suppliers WHERE name = ? COLLATE NOCASE AND archived_at IS NULL').get(data.supplier_name) as { id: number } | undefined)
        : undefined);
    const lines = new Map<number, { product_id: number; qty_milli: number; unit_cost: number }>();
    let skipped = 0;
    for (const l of data.lines) {
      if (l.product_id === null || lines.has(l.product_id)) { skipped++; continue; }
      lines.set(l.product_id, { product_id: l.product_id, qty_milli: l.qty_milli, unit_cost: l.unit_price });
    }
    let receipt: number | null = null;
    if (sup) {
      const cands = db
        .prepare(
          `SELECT r.id FROM goods_receipts r JOIN purchase_orders o ON o.id = r.order_id
           WHERE o.supplier_id = ? AND r.id NOT IN (SELECT receipt_id FROM supplier_invoices) ORDER BY r.id DESC`,
        )
        .all(sup.id) as { id: number }[];
      let best = 0;
      for (const cand of cands) {
        const ids = (db.prepare('SELECT product_id FROM goods_receipt_lines WHERE receipt_id = ?').all(cand.id) as { product_id: number }[]).map((p) => p.product_id);
        const overlap = ids.filter((p) => lines.has(p)).length;
        if (overlap > best) { best = overlap; receipt = cand.id; }
      }
    }
    const body: SiPrefill = {
      extraction_id: id,
      supplier_id: sup?.id ?? null,
      receipt_id: receipt,
      supplier_invoice_no: data.invoice_number ?? '',
      invoice_date: data.invoice_date,
      due_date: data.due_date,
      stated_total: data.total,
      lines: [...lines.values()],
      skipped_lines: skipped,
    };
    return c.json(body);
  });

  const detail = (id: number): SiDetail => {
    const head = db.prepare(`${SUMMARY} WHERE i.id = ?`).get(id) as Omit<SiSummary, 'status' | 'warning_count'> | undefined;
    if (!head) throw new HttpError(404, 'Supplier invoice not found');
    const extra = db
      .prepare('SELECT i.note, i.ppn_rate_bp, i.stated_total, i.extraction_id, u.name AS created_by_name FROM supplier_invoices i JOIN users u ON u.id = i.created_by WHERE i.id = ?')
      .get(id) as Pick<SiDetail, 'note' | 'ppn_rate_bp' | 'stated_total' | 'extraction_id' | 'created_by_name'>;
    const lines = db
      .prepare(
        `SELECT l.product_id, p.sku, p.name, p.base_unit, l.qty_milli, l.unit_cost,
           CAST(ROUND(l.qty_milli * l.unit_cost / 1000.0) AS INTEGER) AS amount, rl.qty_milli AS received_milli, rl.unit_cost AS receipt_unit_cost
         FROM supplier_invoice_lines l JOIN products p ON p.id = l.product_id
         JOIN supplier_invoices i ON i.id = l.invoice_id
         LEFT JOIN goods_receipt_lines rl ON rl.receipt_id = i.receipt_id AND rl.product_id = l.product_id
         WHERE l.invoice_id = ? ORDER BY l.id`,
      )
      .all(id) as SiLine[];
    const warnings = matchWarnings(db, id);
    return { ...summarize([head])[0], ...extra, lines, warnings };
  };

  app.get('/:id', (c) => c.json(detail(parseId(c.req.param('id')))));

  app.post('/', async (c) => {
    const input = parse(siInputSchema, await readJson(c));
    return c.json(detail(createSupplierInvoice(db, input, c.get('user').id)), 201);
  });

  return app;
}
