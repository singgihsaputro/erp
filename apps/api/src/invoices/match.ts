import type { Db } from '../db.js';

interface Candidate {
  id: number;
  sku: string;
  barcode: string | null;
  words: Set<string>;
}

// Words that say nothing about which product it is.
const STOP = new Set(['per', 'isi', 'dan', 'the', 'of', 'x', 'ukuran', 'merk']);

/** "Beras Premium 5kg (isi 2)" → {beras, premium, 5, kg, 2} */
export function words(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w));
  return new Set(tokens);
}

/** Dice coefficient of two word sets: 1 is identical, 0 shares nothing. */
function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return (2 * shared) / (a.size + b.size);
}

const MIN_SIMILARITY = 0.5;

/**
 * Suggests a catalogue product for each invoice line: an exact SKU or barcode
 * anywhere in the row wins; otherwise the most similar name, if it is clearly
 * similar and clearly the best. A wrong guess costs more than no guess, so
 * ties and weak matches are left for a person.
 */
export function matchProducts(db: Db, rows: { description: string; text: string }[]): (number | null)[] {
  const products = (
    db.prepare('SELECT id, sku, barcode, name FROM products WHERE archived_at IS NULL').all() as {
      id: number;
      sku: string;
      barcode: string | null;
      name: string;
    }[]
  ).map((p): Candidate => ({ id: p.id, sku: p.sku.toUpperCase(), barcode: p.barcode, words: words(p.name) }));

  return rows.map((row) => {
    const tokens = new Set(row.text.toUpperCase().split(/[\s,;|]+/).filter(Boolean));
    const exact = products.find((p) => tokens.has(p.sku) || (p.barcode !== null && tokens.has(p.barcode.toUpperCase())));
    if (exact) return exact.id;

    const w = words(row.description);
    let best: { id: number; score: number } | null = null;
    let second = 0;
    for (const p of products) {
      const score = similarity(w, p.words);
      if (!best || score > best.score) {
        second = best?.score ?? 0;
        best = { id: p.id, score };
      } else if (score > second) second = score;
    }
    if (!best || best.score < MIN_SIMILARITY || best.score - second < 0.1) return null;
    return best.id;
  });
}
