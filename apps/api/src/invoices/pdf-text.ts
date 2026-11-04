import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { HttpError } from '../http.js';

/** A run of text on a line, with where it starts and ends horizontally (PDF points). */
export interface TextCell {
  x: number;
  end: number;
  text: string;
}

/** One visual line of a page: cells left to right, split wherever there is a column-sized gap. */
export interface TextLine {
  page: number;
  y: number;
  height: number;
  cells: TextCell[];
  /** The cells joined with wide spacing, for display and for patterns that span cells. */
  text: string;
}

export interface PdfText {
  pageCount: number;
  lines: TextLine[];
}

interface Item {
  x: number;
  y: number;
  w: number;
  h: number;
  str: string;
}

/**
 * Reads the text layer of a PDF. Scanned invoices have no text layer and come
 * back with no lines; reading those would need OCR, which this does not do.
 */
export async function readPdfText(data: Uint8Array): Promise<PdfText> {
  let doc;
  try {
    // pdf.js takes ownership of the buffer it is given, so hand it a copy.
    doc = await getDocument({
      data: data.slice(),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    }).promise;
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'PasswordException') throw new HttpError(422, 'This PDF is password-protected. Upload an unprotected copy.');
    throw new HttpError(422, 'This file could not be read as a PDF.');
  }
  try {
    const lines: TextLine[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: Item[] = [];
      for (const it of content.items) {
        if (!('str' in it) || it.str.trim() === '') continue;
        const [, , , d, x, y] = it.transform as number[];
        items.push({ x, y, w: it.width, h: it.height || Math.abs(d) || 10, str: it.str });
      }
      lines.push(...groupLines(items, p));
      page.cleanup();
    }
    return { pageCount: doc.numPages, lines };
  } finally {
    await doc.destroy();
  }
}

/** Groups positioned text into lines (top to bottom) and each line into cells (left to right). */
export function groupLines(items: Item[], page: number): TextLine[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Item[][] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    const ref = row?.[0];
    if (ref && Math.abs(ref.y - it.y) <= Math.max(2, Math.min(ref.h, it.h) * 0.4)) row.push(it);
    else rows.push([it]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    const height = Math.max(...row.map((i) => i.h));
    const cells: TextCell[] = [];
    for (const it of row) {
      const last = cells[cells.length - 1];
      const gap = last ? it.x - last.end : Infinity;
      // A gap wider than about one character height is a column boundary;
      // anything narrower is a space between words of the same cell.
      if (last && gap < Math.max(6, height * 0.9)) {
        last.text += gap > height * 0.12 ? ` ${it.str}` : it.str;
        last.end = Math.max(last.end, it.x + it.w);
      } else {
        cells.push({ x: it.x, end: it.x + it.w, text: it.str });
      }
    }
    for (const c of cells) c.text = c.text.replace(/\s+/g, ' ').trim();
    return { page, y: row[0].y, height, cells, text: cells.map((c) => c.text).join('   ') };
  });
}

export const linesToText = (lines: TextLine[]) => {
  const out: string[] = [];
  lines.forEach((l, i) => {
    if (i > 0 && l.page !== lines[i - 1].page) out.push(`--- page ${l.page} ---`);
    out.push(l.text);
  });
  return out.join('\n');
};
