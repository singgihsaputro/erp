import { useEffect, useRef, useState } from 'react';

/**
 * Draws the invoice's pages with pdf.js rather than the browser's own PDF
 * viewer, which Android Chrome does not show inside a page at all. pdf.js is
 * loaded only when an invoice is opened, so the rest of the app stays light.
 */
export default function PdfPreview({ url, title }: { url: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;
    (async () => {
      try {
        const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()), isEvalSupported: false }).promise;
        destroy = () => void doc.destroy();
        const el = box.current;
        if (cancelled || !el) return;
        el.replaceChildren();
        const width = el.clientWidth || 600;
        for (let p = 1; p <= doc.numPages; p++) {
          const page = await doc.getPage(p);
          if (cancelled) return;
          const scale = (width / page.getViewport({ scale: 1 }).width) * Math.min(window.devicePixelRatio || 1, 2);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = 'mb-2 block w-full rounded border bg-white shadow-sm';
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', `${title}, page ${p} of ${doc.numPages}`);
          el.append(canvas);
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
        }
        if (!cancelled) setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [url, title]);

  return (
    <div>
      {state === 'loading' && <p className="rounded border bg-white p-8 text-center text-sm text-slate-500">Drawing the PDF…</p>}
      {state === 'error' && (
        <p className="rounded border bg-white p-8 text-center text-sm text-slate-600">
          The PDF could not be shown here.{' '}
          <a className="text-blue-700 underline" href={url} target="_blank" rel="noreferrer">Open it in a new tab</a>
        </p>
      )}
      <div ref={box} className="max-h-[80vh] overflow-y-auto" />
    </div>
  );
}
