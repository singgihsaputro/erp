import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDb } from '../src/db.js';
import { nextDocumentNumber } from '../src/settings.js';
import { json, signIn, type Client } from './helpers.js';

let app: Client;
let db: ReturnType<typeof openDb>;
const company = { name: 'CV Berkah Abadi', address: 'Jl. Kenanga 3, Bandung', phone: '022-123', email: 'a@b.id', npwp: '012345678412000', ppn_rate_bp: 1200, logo_data_url: '' };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
});
const put = (path: string, body?: unknown) => app.request(path, json('PUT', body));

describe('company settings API', () => {
  it('requires sign-in; cashiers may read but not change', async () => {
    expect((await createApp(db).request('/api/settings/company')).status).toBe(401);
    expect((await createApp(db).request('/api/settings/document-prefixes')).status).toBe(401);
    db.prepare("INSERT INTO users (username, name, role, password_hash) VALUES ('kasir', 'Kasir', 'cashier', ?)").run(hashPassword('kasir-1234'));
    const cashier = await signIn(createApp(db), 'kasir', 'kasir-1234');
    expect((await cashier.request('/api/settings/company')).status).toBe(200);
    expect((await cashier.request('/api/settings/company', json('PUT', company))).status).toBe(403);
    expect((await cashier.request('/api/settings/document-prefixes', json('PUT', { prefixes: { journal: 'JU' } }))).status).toBe(403);
  });

  it('defaults to PPN 11%', async () => {
    const c = await (await app.request('/api/settings/company')).json();
    expect(c).toMatchObject({ ppn_rate_bp: 1100, logo_data_url: '' });
    expect(c.name).toBeTruthy();
  });

  it('saves the company, formatting the NPWP, and keeps a logo', async () => {
    const res = await put('/api/settings/company', { ...company, logo_data_url: PNG });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'CV Berkah Abadi', npwp: '01.234.567.8-412.000', ppn_rate_bp: 1200, logo_data_url: PNG });
    expect(await (await app.request('/api/settings/company')).json()).toMatchObject({ ppn_rate_bp: 1200 });
  });

  it('rejects invalid input with 400', async () => {
    for (const bad of [
      { ...company, name: ' ' },
      { ...company, npwp: '123' },
      { ...company, email: 'nope' },
      { ...company, ppn_rate_bp: -1 },
      { ...company, ppn_rate_bp: 10001 },
      { ...company, ppn_rate_bp: 11.5 },
      { ...company, logo_data_url: 'data:image/svg+xml;base64,PHN2Zz4=' },
      { ...company, logo_data_url: 'data:image/png;base64,' + 'A'.repeat(300_000) },
    ]) {
      expect((await put('/api/settings/company', bad)).status).toBe(400);
    }
    expect((await app.request('/api/settings/company', { method: 'PUT', body: 'x' })).status).toBe(400);
  });
});

describe('document prefixes', () => {
  it('lists every document type with its next number', async () => {
    const list = await (await app.request('/api/settings/document-prefixes')).json();
    const inv = list.find((r: { doc_type: string }) => r.doc_type === 'sales_invoice');
    expect(inv.prefix).toBe('INV');
    expect(inv.next_number).toMatch(/^INV\/\d{4}\/\d{2}\/0001$/);
  });

  it('changes a prefix (upper-cased) and numbers with it', async () => {
    const res = await put('/api/settings/document-prefixes', { prefixes: { sales_invoice: 'fk' } });
    expect(res.status).toBe(200);
    expect(nextDocumentNumber(db, 'sales_invoice')).toMatch(/^FK\/\d{4}\/\d{2}\/0001$/);
  });

  it('rejects a bad or duplicate prefix', async () => {
    expect((await put('/api/settings/document-prefixes', { prefixes: { journal: 'a/b' } })).status).toBe(400);
    expect((await put('/api/settings/document-prefixes', { prefixes: { journal: '' } })).status).toBe(400);
    expect((await put('/api/settings/document-prefixes', { prefixes: { nonsense: 'X' } })).status).toBe(400);
    // within the request
    expect((await put('/api/settings/document-prefixes', { prefixes: { journal: 'ZZ', payment: 'ZZ' } })).status).toBe(400);
    // against an untouched type: INV belongs to sales_invoice
    const res = await put('/api/settings/document-prefixes', { prefixes: { journal: 'INV' } });
    expect(res.status).toBe(409);
    const list = await (await app.request('/api/settings/document-prefixes')).json();
    expect(list.find((r: { doc_type: string }) => r.doc_type === 'journal').prefix).toBe('JV');
  });
});

describe('nextDocumentNumber', () => {
  it('is sequential per prefix per month, in Jakarta time', () => {
    const nov = new Date('2026-11-09T10:00:00Z');
    expect(nextDocumentNumber(db, 'sales_invoice', nov)).toBe('INV/2026/11/0001');
    expect(nextDocumentNumber(db, 'sales_invoice', nov)).toBe('INV/2026/11/0002');
    expect(nextDocumentNumber(db, 'purchase_order', nov)).toBe('PO/2026/11/0001');
    // 17:30 UTC on 30 Nov is already 1 Dec in Jakarta
    expect(nextDocumentNumber(db, 'sales_invoice', new Date('2026-11-30T17:30:00Z'))).toBe('INV/2026/12/0001');
    expect(nextDocumentNumber(db, 'sales_invoice', nov)).toBe('INV/2026/11/0003');
  });
});
