import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { ROLE_LABELS, type Role } from '@erp/shared';
import ChangePasswordDialog from './modules/auth/ChangePasswordDialog';
import LoginPage from './modules/auth/LoginPage';
import { INVOICE_ROLES, useMe, useSignOut } from './modules/auth/session';
import InboxPage from './modules/invoices/InboxPage';
import ReviewPage from './modules/invoices/ReviewPage';
import CatalogPage from './modules/catalog/CatalogPage';
import CustomersPage, { CUSTOMER_MANAGERS } from './modules/customers/CustomersPage';
import SuppliersPage, { SUPPLIER_MANAGERS } from './modules/suppliers/SuppliersPage';
import WarehousesPage, { WAREHOUSE_MANAGERS } from './modules/warehouses/WarehousesPage';
import ProductsPage from './modules/products/ProductsPage';

interface NavItem {
  to: string;
  label: string;
  roles?: Role[];
}

const sections: { title: string; items: NavItem[] }[] = [
  { title: 'Master data', items: [
      { to: '/products', label: 'Products' },
      { to: '/catalog', label: 'Categories & units' },
      { to: '/warehouses', label: 'Warehouses' },
      { to: '/suppliers', label: 'Suppliers' },
      { to: '/customers', label: 'Customers' },
    ],
  },
  { title: 'Purchasing', items: [{ to: '/invoices', label: 'Invoice inbox', roles: INVOICE_ROLES }] },
];

export default function App() {
  const me = useMe();
  if (me.isPending) return <p className="p-6 text-sm text-slate-500">Loading…</p>;
  if (me.isError) {
    return (
      <p role="alert" className="m-6 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
        The ERP server is not answering: {me.error.message}{' '}
        <button className="underline" onClick={() => me.refetch()}>Retry</button>
      </p>
    );
  }
  if (!me.data) return <LoginPage />;
  return <Shell role={me.data.role} name={me.data.name} />;
}

function Shell({ role, name }: { role: Role; name: string }) {
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const signOut = useSignOut();
  const can = (item: NavItem) => !item.roles || item.roles.includes(role);
  const canInvoices = INVOICE_ROLES.includes(role);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 md:flex">
      <aside
        className={`${open ? 'block' : 'hidden'} bg-slate-900 text-slate-100 md:block md:w-56 md:shrink-0`}
        aria-label="Sidebar"
      >
        <div className="hidden px-5 py-4 text-lg font-semibold md:block">ERP UMKM</div>
        <nav className="flex flex-col gap-1 px-3 pb-3 md:pb-0">
          {sections.map((s) => {
            const items = s.items.filter(can);
            if (!items.length) return null;
            return (
              <div key={s.title} className="flex flex-col gap-1">
                <div className="px-2 pt-2 text-xs uppercase tracking-wide text-slate-400">{s.title}</div>
                {items.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      `rounded px-3 py-2 text-sm ${isActive ? 'bg-slate-700 font-medium' : 'hover:bg-slate-800'}`
                    }
                  >
                    {n.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-white px-4 py-3">
          <button
            className="rounded border px-2 py-1 text-sm md:hidden"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            ☰
          </button>
          <span className="font-semibold md:hidden">ERP UMKM</span>
          <span className="hidden text-sm text-slate-500 sm:inline">Toko Maju Jaya</span>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="flex items-center gap-1.5">
              <span>{name}</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{ROLE_LABELS[role]}</span>
            </span>
            <button className="text-blue-700 hover:underline" onClick={() => setChangingPassword(true)}>
              Change password
            </button>
            <button className="text-slate-600 hover:underline" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
              Sign out
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Routes>
            <Route path="/" element={<Navigate to={canInvoices ? '/invoices' : '/products'} replace />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/customers" element={<CustomersPage canManage={CUSTOMER_MANAGERS.includes(role)} />} />
            <Route path="/suppliers" element={<SuppliersPage canManage={SUPPLIER_MANAGERS.includes(role)} />} />
            <Route path="/warehouses" element={<WarehousesPage canManage={WAREHOUSE_MANAGERS.includes(role)} />} />
            {canInvoices && <Route path="/invoices" element={<InboxPage />} />}
            {canInvoices && <Route path="/invoices/:id" element={<ReviewPage />} />}
            <Route path="*" element={<p>Page not found.</p>} />
          </Routes>
        </main>
      </div>
      {changingPassword && <ChangePasswordDialog onClose={() => setChangingPassword(false)} />}
    </div>
  );
}
