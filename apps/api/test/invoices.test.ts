import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { InvoiceData, InvoiceExtraction } from '@erp/shared';
import { createApp } from '../src/app.js';
import { openDb, type Db } from '../src/db.js';
import { SAMPLE_INVOICES, scannedLookalike } from '../src/invoices/samples.js';
import { seedDemo } from '../src/seed-data.js';
import { json, signIn, type Client } from './helpers.js';

let db: Db;
let app: Client;
const pdfs: Uint8Array[] = [];

beforeAll(async () => {
  for (const s of SAMPLE_INVOICES) pdfs.push(await s.build());
});

beforeEach(async () => {
  db = openDb(':memory:');
  seedDemo(db);
  app = await signIn(createApp(db));
});

const upload = (bytes: Uint8Array | string, name = 'invoice.pdf', field = 'file') => {
  const form = new FormData();
  form.append(field, new File([bytes as BlobPart], name, { type: 'application/pdf' }));
  return app.request('/api/invoice-extractions', { method: 'POST', body: form });
};
const uploaded = async (i: number): Promise<InvoiceExtraction> => {
  const res = await upload(pdfs[i], SAMPLE_INVOICES[i].file);
  expect(res.status).toBe(201);
  return res.json();
};
const put = (id: number, data: InvoiceData) => app.request(`/api/invoice-extractions/${id}`, json('PUT', data));
const post = (id: number, action: string, body?: unknown) => app.request(`/api/invoice-extractions/${id}/${action}`, json('POST', body));

describe('uploading a PDF invoice', () => {
  it('extracts it, suggests products, and files it for review', async () => {
    const inv = await uploaded(0);
    expect(inv).toMatchObject({
      status: 'review',
      file_name: 'sumber-pangan-lestari-INV-SPL-2026-11-0042.pdf',
      supplier_name: 'PT Sumber Pangan Lestari',
      invoice_number: 'INV/SPL/2026/11/0042',
      total: 3152400,
      errors: 0,
      warnings: 0,
      page_count: 1,
      uploaded_by_name: 'Admin',
      duplicate_of: null,
    });
    expect(inv.data.lines.every((l) => l.product_id !== null)).toBe(true);
    expect(inv.extracted).toEqual(inv.data);
    expect(inv.raw_text).toContain('FAKTUR PENJUALAN');
    expect(inv.found.invoice_date).toContain('2 November 2026');
  });

  it('serves the original PDF back', async () => {
    const inv = await uploaded(2);
    const res = await app.request(`/api/invoice-extractions/${inv.id}/file`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('makmur-sejahtera-0142.pdf');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(pdfs[2]);
  });

  it('refuses the same file twice with 409, naming the first', async () => {
    const first = await uploaded(1);
    const again = await upload(pdfs[1], 'renamed.pdf');
    expect(again.status).toBe(409);
    expect((await again.json()).details.id).toBe(first.id);
  });

  it('refuses what it cannot read: not a PDF 415, scanned 422, broken 422, missing 400, too big 413', async () => {
    expect((await upload('hello, not a pdf', 'notes.pdf')).status).toBe(415);
    expect((await upload('', 'empty.pdf')).status).toBe(415);
    const scanned = await upload(await scannedLookalike(), 'scan.pdf');
    expect(scanned.status).toBe(422);
    expect((await scanned.json()).error).toMatch(/scan/i);
    expect((await upload('%PDF-1.7 garbage that is not a real pdf', 'broken.pdf')).status).toBe(422);
    expect((await upload(pdfs[0], 'x.pdf', 'document')).status).toBe(400);
    expect((await app.request('/api/invoice-extractions', json('POST', { file: 'x' }))).status).toBe(400);
    const big = new Uint8Array(10 * 1024 * 1024 + 70 * 1024);
    big.set(new TextEncoder().encode('%PDF-1.7'));
    expect((await upload(big, 'big.pdf')).status).toBe(413);
    expect((db.prepare('SELECT COUNT(*) AS n FROM invoice_extractions').get() as { n: number }).n).toBe(0);
  });
});

describe('the inbox', () => {
  it('lists newest first, filters by status, and searches supplier, number and file name', async () => {
    const a = await uploaded(0);
    const b = await uploaded(1);
    await uploaded(2);
    await post(a.id, 'reject', { reason: 'Wrong outlet' });
    const list = async (qs = '') => (await app.request(`/api/invoice-extractions${qs}`)).json();
    const all = await list();
    expect(all.total).toBe(3);
    expect(all.items[0].file_name).toBe('makmur-sejahtera-0142.pdf');
    expect((await list('?status=rejected')).items.map((i: { id: number }) => i.id)).toEqual([a.id]);
    expect((await list('?status=review')).total).toBe(2);
    expect((await list('?q=berkah')).items[0].id).toBe(b.id);
    expect((await list('?q=0142')).total).toBe(1);
    expect((await list('?q=%25')).total).toBe(0);
    expect((await app.request('/api/invoice-extractions?status=paid')).status).toBe(400);
    // counts come from the checks: Berkah has an unmatched line, a warning
    expect(all.items.find((i: { id: number }) => i.id === b.id).warnings).toBe(1);
  });

  it('returns 404 for a missing invoice and 400 for a bad id', async () => {
    expect((await app.request('/api/invoice-extractions/999')).status).toBe(404);
    expect((await app.request('/api/invoice-extractions/999/file')).status).toBe(404);
    expect((await app.request('/api/invoice-extractions/x')).status).toBe(400);
  });
});

describe('reviewing and deciding', () => {
  it('saves corrections and keeps what was extracted unchanged', async () => {
    const inv = await uploaded(1);
    const biscuit = (db.prepare("SELECT id FROM products WHERE sku = 'WFR-CKL-140'").get() as { id: number }).id;
    const data = { ...inv.data, lines: inv.data.lines.map((l, i) => (i === 4 ? { ...l, product_id: biscuit } : l)) };
    const res = await put(inv.id, { ...data, due_date: '2026-11-20' });
    expect(res.status).toBe(200);
    const saved: InvoiceExtraction = await res.json();
    expect(saved.data.due_date).toBe('2026-11-20');
    expect(saved.data.lines[4].product_id).toBe(biscuit);
    expect(saved.warnings).toBe(0);
    expect(saved.extracted.due_date).toBe('2026-11-17');
    expect(saved.extracted.lines[4].product_id).toBeNull();
  });

  it('validates corrections', async () => {
    const inv = await uploaded(0);
    const bad: unknown[] = [
      { ...inv.data, invoice_date: '2026-02-30' },
      { ...inv.data, total: 10.5 },
      { ...inv.data, lines: [{ ...inv.data.lines[0], qty_milli: 0 }] },
      { ...inv.data, lines: [{ ...inv.data.lines[0], description: ' ' }] },
      { ...inv.data, lines: 'none' },
    ];
    for (const b of bad) expect((await put(inv.id, b as InvoiceData)).status).toBe(400);
    const unknownProduct = await put(inv.id, { ...inv.data, lines: [{ ...inv.data.lines[0], product_id: 9999 }] });
    expect(unknownProduct.status).toBe(400);
    expect((await unknownProduct.json()).error).toMatch(/9999/);
  });

  it('will not confirm while the numbers do not add up', async () => {
    const inv = await uploaded(0);
    await put(inv.id, { ...inv.data, total: 3000000, invoice_number: null });
    const res = await post(inv.id, 'confirm');
    expect(res.status).toBe(409);
    const fields = (await res.json()).details.issues.map((i: { field: string }) => i.field);
    expect(fields).toEqual(expect.arrayContaining(['invoice_number', 'total']));
    expect((await app.request(`/api/invoice-extractions/${inv.id}`).then((r) => r.json())).status).toBe('review');
  });

  it('confirms a correct invoice, after which it can no longer change', async () => {
    const inv = await uploaded(2);
    const res = await post(inv.id, 'confirm');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'confirmed', decided_by_name: 'Admin' });
    expect((await put(inv.id, inv.data)).status).toBe(409);
    expect((await post(inv.id, 'confirm')).status).toBe(409);
    expect((await post(inv.id, 'reject', { reason: 'x' })).status).toBe(409);
    expect((await app.request(`/api/invoice-extractions/${inv.id}`, { method: 'DELETE' })).status).toBe(409);
  });

  it('rejects with a reason, reopens, and deletes what is not confirmed', async () => {
    const inv = await uploaded(0);
    expect((await post(inv.id, 'reject', { reason: '' })).status).toBe(400);
    expect((await post(inv.id, 'reopen')).status).toBe(409);
    const rejected = await post(inv.id, 'reject', { reason: 'Sent to the wrong outlet' });
    expect(await rejected.json()).toMatchObject({ status: 'rejected', rejected_reason: 'Sent to the wrong outlet' });
    expect((await put(inv.id, inv.data)).status).toBe(409);
    const reopened = await post(inv.id, 'reopen');
    expect(await reopened.json()).toMatchObject({ status: 'review', rejected_reason: null, decided_by_name: null });
    expect((await app.request(`/api/invoice-extractions/${inv.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/api/invoice-extractions/${inv.id}`)).status).toBe(404);
  });

  it('flags another invoice with the same supplier and number as a possible duplicate', async () => {
    const a = await uploaded(0);
    const b = await uploaded(1);
    await put(b.id, { ...b.data, supplier_name: 'pt sumber pangan lestari', invoice_number: 'inv/spl/2026/11/0042' });
    const dup: InvoiceExtraction = await (await app.request(`/api/invoice-extractions/${b.id}`)).json();
    expect(dup.duplicate_of).toEqual({ id: a.id, status: 'review' });
    await post(a.id, 'reject', { reason: 'duplicate' });
    expect((await (await app.request(`/api/invoice-extractions/${b.id}`)).json()).duplicate_of).toBeNull();
  });
});
