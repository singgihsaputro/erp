// Captures docs/screenshots/*.png. Expects the app running (npm run dev) with seed data loaded.
import { chromium } from 'playwright-core';

const base = process.env.WEB_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.goto(`${base}/products`);
await page.getByText('Beras Premium Pandan Wangi 5 kg').waitFor();
await page.screenshot({ path: 'docs/screenshots/F001-products.png' });

// end-to-end check: search narrows the list
await page.getByLabel('Search products').fill('minyak');
await page.getByText('Beras Premium Pandan Wangi 5 kg').waitFor({ state: 'hidden' });
await page.getByText('Minyak Goreng Sawit 2 liter').waitFor();
await browser.close();
console.log('saved docs/screenshots/F001-products.png');
