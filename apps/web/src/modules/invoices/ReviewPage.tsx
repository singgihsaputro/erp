import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  checkInvoice,
  formatRupiah,
  sumLines,
  type InvoiceData,
  type InvoiceExtraction,
  type InvoiceField,
  type InvoiceIssue,
  type Page,
  type Product,
} from '@erp/shared';
import { api, ApiError } from '../../lib/api';
import { formatStamp } from '../../lib/format';
import { fromForm, STATUS_LABEL, STATUS_STYLE, toForm, type InvoiceForm } from './form';
import LinesEditor from './LinesEditor';
import PdfPreview from './PdfPreview';

export default function ReviewPage() {
  const { id } = useParams();
  const invoice = useQuery({ queryKey: ['invoice', id], queryFn: () => api<InvoiceExtraction>(`/invoice-extractions/${id}`) });
  const products = useQuery({
    queryKey: ['products', 'options'],
    queryFn: () => api<Page<Product>>('/products?status=active&page_size=200'),
  });

  if (invoice.isPending) return <p className="text-sm text-slate-500">Loading invoice…</p>;
  if (invoice.isError) {
    return (
      <div className="space-y-3">
        <BackLink />
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {invoice.error instanceof ApiError && invoice.error.status === 404 ? 'This invoice does not exist.' : `Could not load the invoice: ${invoice.error.message}`}
        </p>
      </div>
    );
  }
  // Remounts with a fresh form whenever the saved invoice changes.
  return <Review key={invoice.data.updated_at} inv={invoice.data} products={products.data?.items ?? []} />;
}

const BackLink = () => (
  <Link to="/invoices" className="text-sm text-blue-700 hover:underline">
    ← Invoice inbox
  </Link>
);

function Review({ inv, products }: { inv: InvoiceExtraction; products: Product[] }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<InvoiceForm>(() => toForm(inv.data));
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, invalid } = useMemo(() => fromForm(form), [form]);
  const issues = useMemo(() => checkInvoice(data), [data]);
  const errors = issues.filter((i) => i.level === 'error');
  const dirty = JSON.stringify(data) !== JSON.stringify(inv.data);
  const editable = inv.status === 'review';

  const settle = (next: InvoiceExtraction) => {
    setActionError(null);
    qc.setQueryData(['invoice', String(inv.id)], next);
    qc.invalidateQueries({ queryKey: ['invoices'] });
  };
  const fail = (e: Error) => setActionError(e.message);
  const put = (d: InvoiceData) => api<InvoiceExtraction>(`/invoice-extractions/${inv.id}`, { method: 'PUT', body: d });
  const act = (action: string, body?: unknown) =>
    api<InvoiceExtraction>(`/invoice-extractions/${inv.id}/${action}`, { method: 'POST', body });

  const save = useMutation({ mutationFn: () => put(data), onSuccess: settle, onError: fail });
  const confirm = useMutation({
    mutationFn: async () => {
      if (dirty) await put(data);
      return act('confirm');
    },
    onSuccess: settle,
    onError: fail,
  });
  const reject = useMutation({ mutationFn: () => act('reject', { reason }), onSuccess: settle, onError: fail });
  const reopen = useMutation({ mutationFn: () => act('reopen'), onSuccess: settle, onError: fail });
  const remove = useMutation({
    mutationFn: () => api(`/invoice-extractions/${inv.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      navigate('/invoices');
    },
    onError: fail,
  });
  const busy = save.isPending || confirm.isPending || reject.isPending || reopen.isPending || remove.isPending;

  const set = (k: keyof InvoiceForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const fieldProps = (k: InvoiceField & keyof InvoiceForm) => ({
    value: form[k] as string,
    onChange: set(k),
    found: inv.found[k],
    // No discount line means no discount, not a missing value.
    extracted: k === 'discount' && !inv.found.discount ? null : inv.extracted[k],
    issues: issues.filter((i) => i.field === k),
    invalid: invalid.has(k),
    disabled: !editable,
    absent: k === 'discount' ? 'No discount on the PDF' : k === 'ppn' ? 'No PPN on the PDF' : undefined,
  });

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <BackLink />
        <h1 className="w-full text-xl font-semibold">
          {inv.supplier_name ?? 'Unknown supplier'} <span className="font-mono text-base text-slate-500">{inv.invoice_number}</span>
        </h1>
        <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[inv.status]}`}>{STATUS_LABEL[inv.status]}</span>
        <span className="text-xs text-slate-500">
          #{inv.id} · {inv.file_name} · {inv.page_count} {inv.page_count === 1 ? 'page' : 'pages'} · uploaded by {inv.uploaded_by_name},{' '}
          {formatStamp(inv.created_at)}
        </span>
      </div>

      {inv.status === 'confirmed' && (
        <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-800">
          Confirmed by {inv.decided_by_name} on {formatStamp(inv.decided_at)}. A confirmed invoice can no longer change.
        </p>
      )}
      {inv.status === 'rejected' && (
        <p className="rounded bg-slate-100 px-3 py-2 text-sm text-slate-700">
          Rejected by {inv.decided_by_name} on {formatStamp(inv.decided_at)}: “{inv.rejected_reason}”
        </p>
      )}
      {inv.duplicate_of && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Possible duplicate: <Link className="underline" to={`/invoices/${inv.duplicate_of.id}`}>#{inv.duplicate_of.id}</Link> has the same
          supplier and invoice number ({STATUS_LABEL[inv.duplicate_of.status].toLowerCase()}).
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
        <div className="min-w-0 space-y-2">
          <PdfPreview url={`/api/invoice-extractions/${inv.id}/file`} title={inv.file_name} />
          <a href={`/api/invoice-extractions/${inv.id}/file`} target="_blank" rel="noreferrer" className="text-sm text-blue-700 hover:underline">
            Open the PDF in a new tab
          </a>
          <details className="rounded border bg-white p-3 text-sm">
            <summary className="cursor-pointer text-slate-600">Text read from the PDF</summary>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-xs text-slate-700">{inv.raw_text}</pre>
          </details>
        </div>

        <div className="min-w-0 space-y-4">
          <IssuesPanel issues={issues} />

          <fieldset className="min-w-0 grid gap-3 rounded border bg-white p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium">Invoice</legend>
            <Field label="Supplier" {...fieldProps('supplier_name')} />
            <Field label="Supplier NPWP" {...fieldProps('supplier_npwp')} />
            <Field label="Invoice number" {...fieldProps('invoice_number')} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Invoice date" type="date" {...fieldProps('invoice_date')} />
              <Field label="Due date" type="date" {...fieldProps('due_date')} />
            </div>
          </fieldset>

          <fieldset className="min-w-0 rounded border bg-white p-4">
            <legend className="px-1 text-sm font-medium">Lines</legend>
            <LinesEditor
              lines={form.lines}
              onChange={(lines) => setForm({ ...form, lines })}
              products={products}
              invalid={invalid}
              issues={issues}
              disabled={!editable}
            />
          </fieldset>

          <fieldset className="min-w-0 grid gap-3 rounded border bg-white p-4 sm:grid-cols-3">
            <legend className="px-1 text-sm font-medium">Totals</legend>
            <Field label="Subtotal (DPP)" numeric {...fieldProps('subtotal')} hint={`Lines add up to ${formatRupiah(sumLines(data))}`} />
            <Field label="Discount" numeric {...fieldProps('discount')} />
            <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
              <label className="block text-sm">
                PPN %
                <input className={inputClass(invalid.has('ppn_rate'))} inputMode="decimal" value={form.ppn_rate} onChange={set('ppn_rate')} disabled={!editable} />
              </label>
              <Field label="PPN" numeric {...fieldProps('ppn')} />
            </div>
            <Field label="Total" numeric {...fieldProps('total')} />
          </fieldset>

          {actionError && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}

          {editable && !rejecting && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => save.mutate()} disabled={!dirty || invalid.size > 0 || busy} className="rounded border bg-white px-3 py-1.5 text-sm disabled:opacity-40">
                {save.isPending ? 'Saving…' : 'Save changes'}
              </button>
              <button
                onClick={() => confirm.mutate()}
                disabled={errors.length > 0 || invalid.size > 0 || busy}
                title={errors.length ? 'Fix the errors first' : undefined}
                className="rounded bg-green-700 px-3 py-1.5 text-sm text-white disabled:opacity-40"
              >
                {confirm.isPending ? 'Confirming…' : 'Confirm invoice'}
              </button>
              <button onClick={() => setRejecting(true)} disabled={busy} className="rounded border bg-white px-3 py-1.5 text-sm">
                Reject…
              </button>
              <DeleteButton onDelete={() => remove.mutate()} disabled={busy} />
            </div>
          )}
          {editable && rejecting && (
            <form
              className="space-y-2 rounded border bg-white p-3"
              onSubmit={(e) => {
                e.preventDefault();
                reject.mutate();
              }}
            >
              <label className="block text-sm">
                Why is it rejected?
                <input className={inputClass(false)} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required autoFocus
                  placeholder="e.g. not our order, wrong outlet, duplicate" />
              </label>
              <div className="flex gap-2">
                <button type="submit" disabled={!reason.trim() || busy} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
                  Reject invoice
                </button>
                <button type="button" onClick={() => setRejecting(false)} className="rounded border px-3 py-1.5 text-sm">Cancel</button>
              </div>
            </form>
          )}
          {inv.status === 'rejected' && (
            <div className="flex gap-2">
              <button onClick={() => reopen.mutate()} disabled={busy} className="rounded border bg-white px-3 py-1.5 text-sm">Reopen for review</button>
              <DeleteButton onDelete={() => remove.mutate()} disabled={busy} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function DeleteButton({ onDelete, disabled }: { onDelete: () => void; disabled: boolean }) {
  return (
    <button
      onClick={() => {
        if (window.confirm('Delete this invoice and its PDF from the inbox? This cannot be undone.')) onDelete();
      }}
      disabled={disabled}
      className="rounded px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
    >
      Delete
    </button>
  );
}

const inputClass = (bad: boolean) =>
  `mt-1 w-full rounded border px-2 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-700 ${bad ? 'border-red-400 bg-red-50' : 'border-slate-300'}`;

interface FieldProps {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  found: string | null;
  extracted: unknown;
  issues: InvoiceIssue[];
  invalid: boolean;
  disabled: boolean;
  type?: string;
  numeric?: boolean;
  hint?: string;
  /** Said instead of "Not found" when an empty value is normal, such as no discount. */
  absent?: string;
}

/** An input that also says where its value came from: which PDF line, or that the PDF did not have it. */
function Field({ label, value, onChange, found, extracted, issues, invalid, disabled, type = 'text', numeric, hint, absent }: FieldProps) {
  const missing = extracted === null || extracted === undefined || extracted === '';
  return (
    <label className="block text-sm">
      {label}
      <input
        className={`${inputClass(invalid || issues.some((i) => i.level === 'error'))} ${numeric ? 'text-right tabular-nums' : ''}`}
        type={type}
        inputMode={numeric ? 'numeric' : undefined}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
      {found ? (
        <span className="mt-0.5 block truncate text-xs text-slate-400" title={found}>From the PDF: “{found}”</span>
      ) : missing ? (
        <span className={`mt-0.5 block text-xs ${absent ? 'text-slate-400' : 'text-amber-700'}`}>{absent ?? 'Not found in the PDF'}</span>
      ) : (
        <span className="mt-0.5 block text-xs text-slate-400">Not printed — worked out from the lines</span>
      )}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      {issues.map((i, k) => (
        <span key={k} className={`block text-xs ${i.level === 'error' ? 'text-red-600' : 'text-amber-700'}`}>{i.message}</span>
      ))}
    </label>
  );
}

function IssuesPanel({ issues }: { issues: InvoiceIssue[] }) {
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  if (!issues.length) {
    return <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-800">All checks pass: the lines, subtotal, PPN and total add up.</p>;
  }
  return (
    <div className="space-y-1 rounded border bg-white p-3 text-sm" aria-live="polite">
      <p className="font-medium">
        {errors.length > 0 ? `${errors.length} to fix before confirming` : 'Ready to confirm'}
        {warnings.length > 0 && `, ${warnings.length} to check`}
      </p>
      <ul className="space-y-0.5">
        {errors.map((i, k) => (
          <li key={`e${k}`} className="text-red-700">● {i.message}</li>
        ))}
        {warnings.map((i, k) => (
          <li key={`w${k}`} className="text-amber-700">▲ {i.message}</li>
        ))}
      </ul>
    </div>
  );
}
