"use client";

import { useEffect, useMemo, useState } from "react";
import { SectionHeader } from "@/app/components/ui/section-header";
import { Select } from "@/app/components/ui/select";
import { DatePicker } from "@/app/components/ui/date-picker";
import { TrendChart } from "@/app/components/ui/chart";
import { SkeletonChart } from "@/app/components/ui/skeleton";
import { Banner } from "@/app/components/ui/banner";
import { formatDate, zonedDateTimeToUtc, dateKeyInTz } from "@/lib/timezone";
import { formatCost } from "./_view";

type Preset = "7d" | "28d" | "90d" | "month" | "custom";

const PRESET_OPTIONS: Array<{ value: Preset; label: string }> = [
  { value: "7d", label: "7 días" },
  { value: "28d", label: "28 días" },
  { value: "90d", label: "90 días" },
  { value: "month", label: "Este mes" },
  { value: "custom", label: "Personalizado" },
];

interface SpendResponse {
  buckets: Array<{ key: string; cost: number }>;
  totalCost: number;
  rangeStart: string;
  rangeEnd: string;
}

// "YYYY-MM-DD" (CDMX) → etiqueta corta es-MX para el eje X, igual que
// dailySeries un poco más abajo en _view.tsx.
function bucketLabel(key: string): string {
  return formatDate(zonedDateTimeToUtc(key, "00:00"), { day: "2-digit", month: "short" });
}

export function AiSpendChart() {
  const [preset, setPreset] = useState<Preset>("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState(() => dateKeyInTz(new Date()));
  const [data, setData] = useState<SpendResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rangeReady = preset !== "custom" || (!!customFrom && !!customTo);

  useEffect(() => {
    if (!rangeReady) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount/filter-change, mismo idioma que configuracion/ia/page.tsx
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ preset });
    if (preset === "custom") {
      params.set("from", customFrom);
      params.set("to", customTo);
    }

    fetch(`/api/estadisticas/ai-spend?${params.toString()}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Error al cargar el gasto de IA");
        if (!cancelled) setData(json);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error al cargar el gasto de IA");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [preset, customFrom, customTo, rangeReady]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.buckets.map((b) => ({ label: bucketLabel(b.key), cost: b.cost }));
  }, [data]);

  return (
    <section>
      <SectionHeader
        eyebrow="Inteligencia artificial"
        title="Gasto de IA por período"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={preset}
              onChange={(e) => setPreset(e.target.value as Preset)}
              className="w-40"
              aria-label="Ver gasto de IA de"
            >
              {PRESET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            {preset === "custom" && (
              <>
                <DatePicker value={customFrom} onChange={setCustomFrom} placeholder="Desde" max={customTo || undefined} />
                <DatePicker value={customTo} onChange={setCustomTo} placeholder="Hasta" min={customFrom || undefined} />
              </>
            )}
          </div>
        }
      />
      <div className="mt-4">
        {error && (
          <Banner tone="danger" className="mb-3">
            {error}
          </Banner>
        )}
        {!rangeReady ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted">
            Elige fecha &quot;desde&quot; y &quot;hasta&quot; para ver el gasto en ese rango.
          </div>
        ) : loading ? (
          <SkeletonChart />
        ) : (
          <>
            <p className="mb-3 font-mono text-sm text-muted-darker">
              Total del período: <span className="font-medium text-foreground">{formatCost(data?.totalCost ?? 0)}</span>
            </p>
            <TrendChart
              data={chartData}
              series={[{ key: "cost", name: "Gasto" }]}
              height={220}
              valueFormatter={formatCost}
            />
          </>
        )}
      </div>
    </section>
  );
}
