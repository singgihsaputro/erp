import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import ProductsPage from './modules/products/ProductsPage';

const nav = [{ to: '/products', label: 'Products' }];

export default function App() {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 md:flex">
      <aside
        className={`${open ? 'block' : 'hidden'} bg-slate-900 text-slate-100 md:block md:w-56 md:shrink-0`}
        aria-label="Sidebar"
      >
        <div className="hidden px-5 py-4 text-lg font-semibold md:block">ERP UMKM</div>
        <nav className="flex flex-col gap-1 px-3 pb-3 md:pb-0">
          <div className="px-2 pt-2 text-xs uppercase tracking-wide text-slate-400">Master data</div>
          {nav.map((n) => (
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
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b bg-white px-4 py-3">
          <button
            className="rounded border px-2 py-1 text-sm md:hidden"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            ☰
          </button>
          <span className="font-semibold md:hidden">ERP UMKM</span>
          <span className="ml-auto text-sm text-slate-500">Toko Maju Jaya</span>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Routes>
            <Route path="/" element={<Navigate to="/products" replace />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="*" element={<p>Page not found.</p>} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
