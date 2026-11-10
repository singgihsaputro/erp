import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_LOGO_CHARS, type CompanySettings, type DocumentPrefix, type Role } from '@erp/shared';
import { api, ApiError } from '../../lib/api';

export const SETTINGS_MANAGERS: Role[] = ['super_admin', 'owner', 'admin'];

const input = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100';

/** Company name and logo for the header; shared by the app shell and this page. */
export function useCompany() {
  return useQuery({ queryKey: ['settings', 'company'], queryFn: () => api<CompanySettings>('/settings/company') });
}

/** 1100 → "11", 1150 → "11,5" */
const bpToInput = (bp: number) => String(bp / 100).replace('.', ',');
function inputToBp(text: string): number {
  const s = text.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

export default function SettingsPage({ canManage }: { canManage: boolean }) {
  return (
    <section className="grid max-w-4xl gap-6">
      <div>
        <h1 className="text-xl font-semibold">Company settings</h1>
        <p className="text-sm text-slate-500">
          Printed on documents. The PPN rate and number prefixes apply to documents created from now on.
          {!canManage && ' Only owners and admins can change them.'}
        </p>
      </div>
      <CompanyForm canManage={canManage} />
      <PrefixesForm canManage={canManage} />
    </section>
  );
}

function CompanyForm({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const company = useCompany();
  const [form, setForm] = useState<CompanySettings | null>(null);
  const [ppn, setPpn] = useState('11');
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[] | undefined>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (company.data) {
      setForm(company.data);
      setPpn(bpToInput(company.data.ppn_rate_bp));
    }
  }, [company.data]);

  const save = useMutation({
    mutationFn: (body: CompanySettings & { ppn_rate_bp: number }) => api<CompanySettings>('/settings/company', { method: 'PUT', body }),
    onSuccess: () => {
      setError(null);
      setFields({});
      setSaved(true);
      qc.invalidateQueries({ queryKey: ['settings', 'company'] });
    },
    onError: (e) => {
      setSaved(false);
      setError(e.message);
      if (e instanceof ApiError && e.fields) setFields(e.fields);
    },
  });

  if (company.isPending) return <p className="text-sm text-slate-500">Loading company settings…</p>;
  if (company.isError) {
    return (
      <p role="alert" className="text-sm text-red-700">
        Could not load settings: {company.error.message}{' '}
        <button className="underline" onClick={() => company.refetch()}>Retry</button>
      </p>
    );
  }
  if (!form) return null;
  const set = (patch: Partial<CompanySettings>) => {
    setSaved(false);
    setForm({ ...form, ...patch });
  };
  const err = (k: string) => fields[k]?.[0] && <span className="text-xs text-red-700">{fields[k]![0]}</span>;

  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setError('Logo must be a PNG, JPEG or WebP image');
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      if (url.length > MAX_LOGO_CHARS) return setError('Logo is too large (keep it under about 200 KB)');
      setError(null);
      set({ logo_data_url: url });
    };
    reader.readAsDataURL(file);
  };

  return (
    <form
      className="grid gap-3 rounded border bg-white p-4 text-sm"
      aria-label="Company"
      onSubmit={(e) => {
        e.preventDefault();
        const bp = inputToBp(ppn);
        if (Number.isNaN(bp) || bp > 10000) return setError('PPN rate must be a percentage such as 11 or 12');
        save.mutate({ ...form, ppn_rate_bp: bp });
      }}
    >
      <h2 className="font-semibold">Company</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <label>Company name
          <input className={input} value={form.name} maxLength={120} required disabled={!canManage} onChange={(e) => set({ name: e.target.value })} />
          {err('name')}
        </label>
        <label>NPWP
          <input className={input} value={form.npwp} disabled={!canManage} placeholder="01.234.567.8-412.000" onChange={(e) => set({ npwp: e.target.value })} />
          {err('npwp')}
        </label>
        <label className="md:col-span-2">Address
          <textarea className={input} rows={2} value={form.address} maxLength={300} disabled={!canManage} onChange={(e) => set({ address: e.target.value })} />
        </label>
        <label>Phone
          <input className={input} value={form.phone} maxLength={40} disabled={!canManage} onChange={(e) => set({ phone: e.target.value })} />
        </label>
        <label>Email
          <input className={input} type="email" value={form.email} disabled={!canManage} onChange={(e) => set({ email: e.target.value })} />
          {err('email')}
        </label>
        <label>PPN rate (%)
          <input className={input} inputMode="decimal" value={ppn} disabled={!canManage} onChange={(e) => { setSaved(false); setPpn(e.target.value); }} />
          <span className="text-xs text-slate-500">Prices are stored without tax; documents add PPN at this rate.</span>
        </label>
        <div>
          <div>Logo</div>
          <div className="mt-1 flex items-center gap-3">
            {form.logo_data_url ? (
              <img src={form.logo_data_url} alt="Company logo" className="h-14 max-w-32 rounded border object-contain" />
            ) : (
              <span className="flex h-14 w-24 items-center justify-center rounded border border-dashed text-xs text-slate-400">No logo</span>
            )}
            {canManage && (
              <div className="grid gap-1">
                <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload logo" onChange={(e) => pickLogo(e.target.files?.[0])} />
                {form.logo_data_url && (
                  <button type="button" className="justify-self-start text-red-700 hover:underline" onClick={() => set({ logo_data_url: '' })}>
                    Remove logo
                  </button>
                )}
              </div>
            )}
          </div>
          {err('logo_data_url')}
        </div>
      </div>
      {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {saved && <p role="status" className="rounded bg-green-50 px-3 py-2 text-green-800">Company settings saved.</p>}
      {canManage && (
        <div className="flex justify-end">
          <button disabled={save.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Save company</button>
        </div>
      )}
    </form>
  );
}

function PrefixesForm({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['settings', 'prefixes'], queryFn: () => api<DocumentPrefix[]>('/settings/document-prefixes') });
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (list.data) setValues(Object.fromEntries(list.data.map((r) => [r.doc_type, r.prefix])));
  }, [list.data]);

  const save = useMutation({
    mutationFn: () => api<DocumentPrefix[]>('/settings/document-prefixes', { method: 'PUT', body: { prefixes: values } }),
    onSuccess: () => {
      setError(null);
      setSaved(true);
      qc.invalidateQueries({ queryKey: ['settings', 'prefixes'] });
    },
    onError: (e) => {
      setSaved(false);
      const first = e instanceof ApiError && e.fields ? Object.values(e.fields).flat()[0] : undefined;
      setError(first ?? e.message);
    },
  });

  return (
    <form
      className="rounded border bg-white p-4 text-sm"
      aria-label="Document numbers"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2 className="mb-1 font-semibold">Document numbers</h2>
      <p className="mb-3 text-slate-500">Numbers look like PREFIX/YYYY/MM/NNNN and restart every month. Each kind needs its own prefix.</p>
      {list.isPending && <p className="text-slate-500">Loading prefixes…</p>}
      {list.isError && <p role="alert" className="text-red-700">Could not load prefixes: {list.error.message}</p>}
      {list.data && (
        <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
          {list.data.map((r) => (
            <label key={r.doc_type} className="grid grid-cols-[1fr_6rem] items-center gap-2">
              <span>{r.label}<span className="block text-xs text-slate-500">Next: {r.next_number}</span></span>
              <input
                className={input}
                aria-label={`${r.label} prefix`}
                value={values[r.doc_type] ?? ''}
                maxLength={8}
                disabled={!canManage}
                onChange={(e) => { setSaved(false); setValues({ ...values, [r.doc_type]: e.target.value.toUpperCase() }); }}
              />
            </label>
          ))}
        </div>
      )}
      {error && <p role="alert" className="mt-3 rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {saved && <p role="status" className="mt-3 rounded bg-green-50 px-3 py-2 text-green-800">Prefixes saved.</p>}
      {canManage && list.data && (
        <div className="mt-3 flex justify-end">
          <button disabled={save.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Save prefixes</button>
        </div>
      )}
    </form>
  );
}
