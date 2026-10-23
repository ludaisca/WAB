"use client";

import { useEffect, useState } from "react";
import { Megaphone, SendHorizonal } from "lucide-react";
import { Card } from "@/app/components/ui/card";
import { Banner } from "@/app/components/ui/banner";
import { SectionHeader } from "@/app/components/ui/section-header";
import { FormField } from "@/app/components/ui/form-field";
import { Select } from "@/app/components/ui/select";
import { DatePicker } from "@/app/components/ui/date-picker";
import { Button } from "@/app/components/ui/button";
import { Modal } from "@/app/components/ui/modal";
import { EmptyState } from "@/app/components/ui/empty-state";
import { AnimatedNumber } from "@/app/components/ui/animated-number";
import { useToast } from "@/app/components/ui/toast";
import { dateKeyInTz, formatDate, zonedDateTimeToUtc } from "@/lib/timezone";

export interface MessagesSentAccount {
  id: string;
  name: string;
}

export interface MessagesSentCampaignBreakdownRow {
  campaignId: string | null;
  campaignName: string;
  count: number;
}

export interface MessagesSentStats {
  messagesSent: number;
  conversations: number;
  campaignBreakdown: MessagesSentCampaignBreakdownRow[];
}

// Card "Mensajes enviados" del Panel — filtrable por cuenta y rango de
// fechas vía GET /api/dashboard/messages-sent. Mismo idioma que la pestaña
// Campañas de /estadisticas: arranca con lo que ya trajo el Server Component
// (sin filtro, sin round-trip) y solo pega un fetch cuando el usuario activa
// algún filtro.
export function MessagesSentCard({
  accounts,
  initialStats,
}: {
  accounts: MessagesSentAccount[];
  initialStats: MessagesSentStats;
}) {
  const { error: toastError } = useToast();
  const today = dateKeyInTz(new Date());

  const [accountId, setAccountId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [fetchedStats, setFetchedStats] = useState<{ key: string; data: MessagesSentStats } | null>(null);
  const [fetchError, setFetchError] = useState<{ key: string; message: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const hasFilter = accountId !== "" || dateFrom !== "" || dateTo !== "";
  const partialRange = !!dateFrom !== !!dateTo;
  const query = new URLSearchParams({ ...(accountId ? { accountId } : {}), ...(dateFrom && dateTo ? { dateFrom, dateTo } : {}) }).toString();
  const currentError = fetchError?.key === query ? fetchError.message : null;
  const statsReady = !hasFilter || (!partialRange && fetchedStats?.key === query);
  const stats = hasFilter && fetchedStats?.key === query ? fetchedStats.data : initialStats;
  const isLoading = hasFilter && !partialRange && (loading || (!statsReady && !currentError));

  useEffect(() => {
    if (!hasFilter) return;
    if ((dateFrom && !dateTo) || (!dateFrom && dateTo)) return;

    const params = new URLSearchParams();
    if (accountId) params.set("accountId", accountId);
    if (dateFrom && dateTo) {
      params.set("dateFrom", dateFrom);
      params.set("dateTo", dateTo);
    }

    const controller = new AbortController();
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch al cambiar el filtro; el loading debe reflejarse antes de que la respuesta llegue
    setLoading(true);
    fetch(`/api/dashboard/messages-sent?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (!cancelled) { setFetchedStats({ key: query, data }); setFetchError(null); }
      })
      .catch((err) => {
        if (!cancelled) { const message = err instanceof Error ? err.message : "Error al filtrar mensajes enviados"; setFetchError({ key: query, message }); toastError(message); }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; controller.abort(); };
  }, [accountId, dateFrom, dateTo, hasFilter, toastError, query, retry]);

  const filterLabel = `${accountId ? accounts.find((a) => a.id === accountId)?.name ?? "Cuenta" : "Todas las cuentas"} · ${
    dateFrom && dateTo
      ? `${formatDate(zonedDateTimeToUtc(dateFrom, "00:00"))} – ${formatDate(zonedDateTimeToUtc(dateTo, "00:00"))}`
      : "Todo el periodo"
  }`;

  return (
    <section>
      <SectionHeader eyebrow="Actividad" title="Mensajes enviados" />

      <div className="mt-3 flex flex-wrap items-end gap-3">
        {accounts.length > 1 && (
          <FormField label="Cuenta">
            {(id) => (
              <Select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-56">
                <option value="">Todas las cuentas</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            )}
          </FormField>
        )}
        <FormField label="Desde">
          {(id) => <DatePicker id={id} value={dateFrom} onChange={setDateFrom} max={dateTo || today} />}
        </FormField>
        <FormField label="Hasta">
          {(id) => <DatePicker id={id} value={dateTo} onChange={setDateTo} min={dateFrom} max={today} />}
        </FormField>
        {hasFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setAccountId(""); setDateFrom(""); setDateTo(""); }}
          >
            Limpiar filtros
          </Button>
        )}
      </div>

      {partialRange && <p className="mt-3 text-sm text-muted">Selecciona desde y hasta para consultar el periodo.</p>}
      {currentError && hasFilter && <Banner tone="warning" className="mt-3" action={<Button variant="secondary" size="sm" onClick={() => setRetry((prev) => prev + 1)}>Reintentar</Button>}>{currentError}</Banner>}
      <Card padding="sm" className="mt-4 flex flex-wrap items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-bubble bg-accent/10 text-accent">
          <SendHorizonal size={18} />
        </div>
        <div className="min-w-0">
          <p className="font-mono text-hero leading-none">
            {isLoading ? "…" : statsReady ? <AnimatedNumber value={stats.messagesSent} /> : "—"}
          </p>
          <p className="mt-1.5 text-xs text-muted-darker">
            {isLoading ? "Actualizando…" : statsReady ? `${stats.conversations.toLocaleString("es-MX")} conversación${stats.conversations === 1 ? "" : "es"}` : "Sin resultado para este filtro"}
            {" · "}
            {filterLabel}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={Megaphone}
          onClick={() => setBreakdownOpen(true)}
          disabled={isLoading || !statsReady}
          className="w-full sm:w-auto sm:ml-auto shrink-0"
        >
          Desglose por campaña
        </Button>
      </Card>

      <Modal
        open={breakdownOpen}
        onClose={() => setBreakdownOpen(false)}
        title="Mensajes enviados por campaña"
        description={filterLabel}
        size="md"
      >
        {stats.campaignBreakdown.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="Sin mensajes en este filtro"
            description="No hay mensajes enviados que coincidan con la cuenta/rango seleccionado."
          />
        ) : (
          <div className="divide-y divide-border">
            {stats.campaignBreakdown.map((row) => (
              <div
                key={row.campaignId ?? "sin-campania"}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <p className={row.campaignId ? "truncate text-sm" : "truncate text-sm text-muted-darker italic"}>
                  {row.campaignName}
                </p>
                <p className="shrink-0 font-mono text-sm text-muted-darker">
                  {row.count.toLocaleString("es-MX")}
                </p>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 py-2.5 font-medium">
              <p className="text-sm">Total</p>
              <p className="font-mono text-sm">{stats.messagesSent.toLocaleString("es-MX")}</p>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
