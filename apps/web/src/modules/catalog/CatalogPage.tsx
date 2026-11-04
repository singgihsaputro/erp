import CategoriesPanel from './CategoriesPanel';
import UnitsPanel from './UnitsPanel';

export default function CatalogPage() {
  return (
    <section>
      <h1 className="mb-1 text-xl font-semibold">Categories and units</h1>
      <p className="mb-4 text-sm text-slate-500">
        Group products into categories, and define the units they are bought and sold in. Conversions
        (1 dus = 40 pcs, 1 karung = 25 kg) are set per product, in the product form.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <CategoriesPanel />
        <UnitsPanel />
      </div>
    </section>
  );
}
