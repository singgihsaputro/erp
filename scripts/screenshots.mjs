// Captures docs/screenshots/*.png and checks the main flows end to end.
// Expects the app running (npm run dev) on a freshly seeded database (npm run seed).
import { chromium } from 'playwright-core';

const base = process.env.WEB_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const shot = async (name, opts = {}) => {
  await page.screenshot({ path: `docs/screenshots/${name}.png`, ...opts });
  console.log(`saved docs/screenshots/${name}.png`);
};

// F002: sign-in — a wrong password is refused, admin / superuser gets in
await page.goto(`${base}/products`);
await page.getByLabel('Username').waitFor();
await page.getByLabel('Username').fill('admin');
await page.getByLabel('Password').fill('not-the-password');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByText('Wrong username or password').waitFor();
await shot('F002-sign-in');
await page.getByLabel('Password').fill('superuser');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByText('Admin', { exact: true }).waitFor();

// F001: products, still reached after signing in
await page.getByText('Beras Premium Pandan Wangi 5 kg').waitFor();
await shot('F001-products');
await page.getByLabel('Search products').fill('minyak');
await page.getByText('Beras Premium Pandan Wangi 5 kg').waitFor({ state: 'hidden' });
await page.getByText('Minyak Goreng Sawit 2 liter').waitFor();

// F004: categories and units, and a product's unit conversions
await page.getByRole('link', { name: 'Categories & units' }).click();
await page.getByText('Beras & Tepung').waitFor();
await page.getByText('karung').first().waitFor();
await shot('F004-categories-units');
await page.getByRole('link', { name: 'Products', exact: true }).click();
await page.getByLabel('Search products').fill('Mi Instan Goreng Spesial 85');
await page.getByText('Air Mineral Botol 600 ml').waitFor({ state: 'hidden' });
await page.getByRole('button', { name: 'Edit' }).first().click();
await page.getByLabel('Conversion 1 unit').waitFor();
const got = await page.getByLabel('Conversion 1 quantity').inputValue();
if (got !== '40') throw new Error(`expected 1 dus = 40 pcs, got ${got}`);
await shot('F004-product-conversions');
await page.getByRole('button', { name: 'Cancel' }).click();

// F005: warehouses, each with its own stock
await page.getByRole('link', { name: 'Warehouses' }).click();
await page.getByRole('article', { name: 'Gudang Belakang' }).waitFor();
await page.getByRole('article', { name: 'Gudang Cikarang' }).waitFor();
await shot('F005-warehouses');
await page.getByRole('article', { name: 'Gudang Cikarang' }).getByRole('button', { name: 'View stock' }).click();
await page.getByRole('dialog').getByText('Susu UHT Full Cream 1 liter').waitFor();
await page.getByRole('button', { name: 'Close' }).click();

// F003: the inbox, then uploading a PDF and reviewing what was read from it
await page.getByRole('link', { name: 'Invoice inbox' }).click();
await page.getByText('PT Sumber Pangan Lestari').waitFor();
await shot('F003-invoice-inbox');

await page.getByLabel('Upload PDF invoices').setInputFiles('mock/invoices/berkah-niaga-grosir-CBN-2611-0087.pdf');
await page.waitForURL(/\/invoices\/\d+$/);
await page.getByText('Line 5 is not matched to a product.').first().waitFor();
await page.setViewportSize({ width: 1440, height: 1250 });
await page.getByRole('img', { name: /page 1 of 1/ }).waitFor(); // the PDF, drawn by pdf.js
await page.getByText('Drawing the PDF…').waitFor({ state: 'hidden' });
await shot('F003-invoice-review');

// fixing the one warning makes every check pass; then confirm
await page.getByLabel('Line 5 product').selectOption({ label: 'WFR-CKL-140 · Wafer Cokelat 140 g' });
await page.getByText('All checks pass').waitFor();
await page.getByRole('button', { name: 'Confirm invoice' }).click();
await page.getByText(/^Confirmed by Admin/).waitFor();

// sign out returns to the sign-in screen
await page.getByRole('button', { name: 'Sign out' }).click();
await page.getByLabel('Username').waitFor();

await browser.close();
