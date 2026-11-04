import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLE_INVOICES } from './invoices/samples.js';

// Writes the demo supplier invoices to mock/invoices/, for uploading by hand.
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../mock/invoices');
fs.mkdirSync(dir, { recursive: true });
for (const s of SAMPLE_INVOICES) {
  fs.writeFileSync(path.join(dir, s.file), await s.build());
  console.log(`wrote mock/invoices/${s.file}`);
}
