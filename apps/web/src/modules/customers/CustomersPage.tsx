import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PRICE_TIERS, PRICE_TIER_LABELS, formatRupiah, PAYMENT_TERMS, PAYMENT_TERMS_LABELS, type PaymentTerms, type Role, type Customer, type PriceTier } from '@erp/shared';
import { api } from '../../lib/api';

export const CUSTOMER_MANAGERS: Role[] = ['super_admin', 'owner', 'admin'];

const input = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm';
const PAGE = 50;

export default function CustomersPage({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState('');
  const [tier, setTier] = useState('');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Partial<Customer> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['customers', archived, q, tier],
    queryFn: () => api<Customer[]>(`/customers?${archived ? 'archived=1&' : ''}${tier ? `tier=${tier}&` : ''}q=${encodeURIComponent(q)}`),
  });
  const refresh = () => {
    setError(null);
    qc.invalidateQueries({ queryKey: ['customers'] });
  };
  const action = useMutation({
    mutationFn: (a: { id: number; verb: 'archive' | 'restore' }) => api(`/customers/${a.id}/${a.verb}`, { method: 'POST' }),
    onSuccess: refresh,
    onError: (e) => setError(e.message),
  });
  const rows = list.data?.slice(page * PAGE, (page + 1) * PAGE) ?? [];
  const pages = Math.ceil((list.data?.length ?? 0) / PAGE);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Customers</h1>
        <input
          className={`${input} max-w-xs`}
          type="search"
          placeholder="Search name, contact, NPWP, phone"
          aria-label="Search customers"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); }}
        />
        <select className={`${input} max-w-[10rem]`} aria-label="Filter by price tier" value={tier} onChange={(e) => { setTier(e.target.value); setPage(0); }}>
          <option value="">All tiers</option>
          {PRICE_TIERS.map((t) => <option key={t} value={t}>{PRICE_TIER_LABELS[t]}</option>)}
        </select>
        <label className="ml-auto flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={archived} onChange={(e) => { setArchived(e.target.checked); setPage(0); }} />
          Show archived
        </label>
        {canManage && (
          <button className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setEditing({})}>
            Add customer
          </button>
        )}
      </div>
      {error && <p role="alert" className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {list.isPending && <p className="text-sm text-slate-500">Loading customers…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-red-700">
          Could not load customers: {list.error.message}{' '}
          <button className="underline" onClick={() => list.refetch()}>Retry</button>
        </p>
      )}
      {list.data?.length === 0 && (
        <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">
          {q ? 'No customer matches your search.' : archived ? 'No archived customers.' : 'No customers yet.'}
        </p>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Contact</th>
                <th className="px-3 py-2">NPWP</th>
                <th className="px-3 py-2">Price tier</th>
                <th className="px-3 py-2 text-right">Credit limit</th>
                <th className="px-3 py-2">Payment terms</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-slate-500">{s.address || 'No address'}</div>
                  </td>
                  <td className="px-3 py-2">
                    {s.contact_person || '—'}
                    <div className="text-xs text-slate-500">{[s.phone, s.email].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{s.npwp || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2">{PRICE_TIER_LABELS[s.price_tier]}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{s.credit_limit ? formatRupiah(s.credit_limit) : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2">{PAYMENT_TERMS_LABELS[s.payment_terms]}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {canManage && !s.archived_at && (
                      <>
                        <button className="mr-3 text-blue-700 hover:underline" onClick={() => setEditing(s)}>Edit</button>
                        <button
                          className="text-red-700 hover:underline"
                          onClick={() => window.confirm(`Archive customer "${s.name}"?`) && action.mutate({ id: s.id, verb: 'archive' })}
                        >
                          Archive
                        </button>
                      </>
                    )}
                    {canManage && s.archived_at && (
                      <button className="text-blue-700 hover:underline" onClick={() => action.mutate({ id: s.id, verb: 'restore' })}>Restore</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="mt-3 flex items-center gap-3 text-sm">
          <button className="rounded border px-2 py-1 disabled:opacity-40" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page + 1} of {pages}</span>
          <button className="rounded border px-2 py-1 disabled:opacity-40" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
      {editing && <CustomerForm initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </section>
  );
}

function CustomerForm({ initial, onClose, onSaved }: { initial: Partial<Customer>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: initial.name ?? '',
    contact_person: initial.contact_person ?? '',
    phone: initial.phone ?? '',
    email: initial.email ?? '',
    address: initial.address ?? '',
    npwp: initial.npwp ?? '',
    credit_limit: String(initial.credit_limit ?? 0),
    price_tier: (initial.price_tier ?? 'retail') as PriceTier,
    payment_terms: (initial.payment_terms ?? 'cash') as PaymentTerms,
    note: initial.note ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      initial.id ? api(`/customers/${initial.id}`, { method: 'PUT', body: { ...form, credit_limit: Number(form.credit_limit) } }) : api('/customers', { method: 'POST', body: { ...form, credit_limit: Number(form.credit_limit) } }),
    onSuccess: onSaved,
    onError: (e) => {
      const fields = (e as { fields?: Record<string, string[] | undefined> }).fields;
      const detail = fields ? Object.entries(fields).map(([k, v]) => `${k}: ${v?.join(', ')}`).join('; ') : '';
      setError(detail ? `${e.message} — ${detail}` : e.message);
    },
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={initial.id ? 'Edit customer' : 'Add customer'}>
      <div className="max-h-full w-full max-w-lg overflow-auto rounded bg-white p-5 shadow">
        <div className="mb-3 flex items-center">
          <h2 className="text-lg font-semibold">{initial.id ? 'Edit customer' : 'Add customer'}</h2>
          <button className="ml-auto text-slate-500 hover:text-slate-800" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <form className="grid gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <label>Name
            <input className={input} value={form.name} maxLength={120} required onChange={set('name')} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>Contact person
              <input className={input} value={form.contact_person} maxLength={80} onChange={set('contact_person')} />
            </label>
            <label>Phone
              <input className={input} value={form.phone} maxLength={30} onChange={set('phone')} />
            </label>
          </div>
          <label>Email
            <input className={input} type="email" value={form.email} maxLength={120} onChange={set('email')} />
          </label>
          <label>Address
            <textarea className={input} rows={2} value={form.address} maxLength={300} onChange={set('address')} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>NPWP
              <input className={input} value={form.npwp} placeholder="15 or 16 digits" maxLength={30} onChange={set('npwp')} />
            </label>
            <label>Payment terms
              <select className={input} value={form.payment_terms} onChange={set('payment_terms')}>
                {PAYMENT_TERMS.map((t) => <option key={t} value={t}>{PAYMENT_TERMS_LABELS[t]}</option>)}
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>Price tier
              <select className={input} value={form.price_tier} onChange={set('price_tier')}>
                {PRICE_TIERS.map((t) => <option key={t} value={t}>{PRICE_TIER_LABELS[t]}</option>)}
              </select>
            </label>
            <label>Credit limit (Rp)
              <input className={input} type="number" min={0} step={1} value={form.credit_limit} onChange={set('credit_limit')} />
            </label>
          </div>
          <label>Note
            <input className={input} value={form.note} maxLength={300} onChange={set('note')} />
          </label>
          {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Cancel</button>
            <button disabled={save.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}
