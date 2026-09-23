// Formato de moneda real (separador de miles + 2 decimales fijos) — distinto
// del formatCost de estadisticas/_view.tsx y reportes/_dashboard.tsx, que usa
// precisión variable (hasta 4 decimales) pensada para micro-costos de IA
// (ej. $0.0003 por interacción). Este formatter es para montos de dinero
// "reales" (gasto de campañas, facturación) donde 2 decimales siempre bastan.
const currencyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "USD",
  currencyDisplay: "narrowSymbol",
});

export function formatUsd(value: number): string {
  return currencyFormatter.format(value);
}
