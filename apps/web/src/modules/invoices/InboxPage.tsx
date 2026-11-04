import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InvoiceExtraction, InvoiceExtractionSummary, InvoiceStatus, Page } from '@erp/shared';
import { api, ApiError } from '../../lib/api';
import { formatDate, formatStamp } from '../../lib/format';
import { rupiahOrDash, STATUS_LABEL, STATUS_STYLE } from './form';

const PAGE_SIZE = 50;
type Filter = InvoiceStatus | 'all';
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['review', 'To review'],
  ['confirmed', 'Confirmed'],
  ['rejected', 'Rejected'],
];

interface UploadResult {
  name: string;
  ok: boolean;
  message: string;
  id?: number;
}

export default function InboxPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [results, setResults] = useState<UploadResult[]>([]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const query = useQuery({
    queryKey: ['invoices', filter, debouncedQ, page],
    queryFn: () => {
      const p = new URLSearchParams({ status: filter, page: String(page), page_size: String(PAGE_SIZE) });
      if (debouncedQ) p.set('q', debouncedQ);
      return api<Page<InvoiceExtractionSummary>>(`/invoice-extractions?${p}`);
    },
    placeholderData: keepPreviousData,
  });

  async function uploadFiles(files: File[]) {
    const out: UploadResult[] = [];
    for (const file of files) {
      setUploading(file.name);
      const form = new FormData();
      form.append('file', file);
      try {
        const inv = await api<InvoiceExtraction>('/invoice-extractions', { form });
        out.push({ name: file.name, ok: true, id: inv.id, message: `Read as ${inv.supplier_name ?? 'unknown supplier'} · ${inv.invoice_number ?? 'no number found'}` });
      } catch (e) {
        const dupId = e instanceof ApiError && e.status === 409 ? (e.details as { id?: number } | undefined)?.id : undefined;
        out.push({ name: file.name, ok: false, id: dupId, message: (e as Error).message });
      }
    }
    setUploading(null);
    qc.invalidateQueries({ queryKey: ['invoices'] });
    // One file read cleanly: go straight to checking it.
    if (out.length === 1 && out[0].ok && out[0].id) navigate(`/invoices/${out[0].id}`);
    else setResults(out);
  }

  const onFiles = (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (files.length) void uploadFiles(files);
  };

  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <section>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Invoice inbox</h1>
        <p className="text-sm text-slate-500">
          Upload a supplier's PDF invoice. The ERP reads the supplier, number, dates, lines and totals; you check them and confirm.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFiles(e.dataTransfer.files);
        }}
        className={`mb-4 rounded-lg border-2 border-dashed p-6 text-center text-sm ${dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white'}`}
      >
        {uploading ? (
          <p className="text-slate-600">Reading {uploading}…</p>
        ) : (
          <>
            <p className="text-slate-600">Drop PDF invoices here, or</p>
            <button onClick={() => fileInput.current?.click()} className="mt-2 rounded bg-slate-900 px-3 py-1.5 text-white">
              Choose PDF files
            </button>
            <p className="mt-2 text-xs text-slate-400">Text PDFs up to 10 MB. Scanned images are not read yet.</p>
          </>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          aria-label="Upload PDF invoices"
          className="hidden"
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {results.length > 0 && (
        <ul className="mb-4 space-y-1 text-sm" aria-live="polite">
          {results.map((r, i) => (
            <li key={i} className={`rounded px-3 py-2 ${r.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
              <span className="font-medium">{r.name}</span>: {r.message}{' '}
              {r.id && <Link className="underline" to={`/invoices/${r.id}`}>Open #{r.id}</Link>}
            </li>
          ))}
        </ul>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="mr-auto flex flex-wrap gap-1" role="tablist" aria-label="Status filter">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={filter === value}
              onClick={() => {
                setFilter(value);
                setPage(1);
              }}
              className={`rounded px-3 py-1 text-sm ${filter === value ? 'bg-slate-900 text-white' : 'border bg-white text-slate-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search supplier, number or file"
          aria-label="Search invoices"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm sm:w-72"
        />
      </div>

      {query.isPending && <p className="text-sm text-slate-500">Loading invoices…</p>}
      {query.isError && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load invoices: {query.error.message}{' '}
          <button className="underline" onClick={() => query.refetch()}>Retry</button>
        </p>
      )}
      {data && data.items.length === 0 && (
        <p className="rounded border border-dashed bg-white p-8 text-center text-sm text-slate-500">
          {debouncedQ || filter !== 'all'
            ? 'No invoices match your filters.'
            : 'No invoices yet. Upload a supplier PDF above — sample PDFs are in the repository under mock/invoices/.'}
        </p>
      )}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Supplier</th>
                <th className="px-3 py-2">Invoice no.</th>
                <th className="px-3 py-2">Invoice date</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Checks</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Received</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((inv) => (
                <tr key={inv.id} className="cursor-pointer border-t hover:bg-slate-50" onClick={() => navigate(`/invoices/${inv.id}`)}>
                  <td className="px-3 py-2">
                    <Link to={`/invoices/${inv.id}`} className="font-medium text-blue-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                      {inv.supplier_name ?? 'Unknown supplier'}
                    </Link>
                    <div className="max-w-[16rem] truncate text-xs text-slate-400" title={inv.file_name}>{inv.file_name}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{inv.invoice_number ?? '—'}</td>
                  <td className="px-3 py-2">{formatDate(inv.invoice_date)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rupiahOrDash(inv.total)}</td>
                  <td className="px-3 py-2 text-xs">
                    {inv.errors > 0 ? (
                      <span className="text-red-700">{inv.errors} {inv.errors === 1 ? 'error' : 'errors'}</span>
                    ) : inv.warnings > 0 ? (
                      <span className="text-amber-700">{inv.warnings} {inv.warnings === 1 ? 'warning' : 'warnings'}</span>
                    ) : (
                      <span className="text-green-700">All good</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[inv.status]}`}>{STATUS_LABEL[inv.status]}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">
                    {formatStamp(inv.created_at)}
                    <div>{inv.uploaded_by_name}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > data.page_size && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <span>Page {data.page} of {pages} · {data.total} invoices</span>
          <span className="space-x-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border px-3 py-1 disabled:opacity-40">Previous</button>
            <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded border px-3 py-1 disabled:opacity-40">Next</button>
          </span>
        </div>
      )}
    </section>
  );
}
