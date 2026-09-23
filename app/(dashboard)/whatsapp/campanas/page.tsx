"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Megaphone, Trash2 } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { KpiStrip, type KpiItem } from "@/app/components/ui/kpi-strip";
import { Pagination } from "@/app/components/ui/pagination";
import { EntityList, EntityRow } from "@/app/components/ui/entity-list";
import { EntityAvatar } from "@/app/components/ui/avatar";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { PageHeader } from "@/app/components/ui/page-header";
import { useToast } from "@/app/components/ui/toast";
import { formatUsd } from "@/lib/format";

interface Campaign {
  id: string;
  name: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  completedAt: string | null;
  recipientCount: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  totalCostUsd: number;
  createdAt: string;
  waAccount: { id: string; name: string; phoneNumber: string | null };
  waTemplate: { id: string; name: string };
}

const STATUS_BADGE: Record<string, { label: string; tone: "success" | "warning" | "info" | "danger" | "neutral" }> = {
  DRAFT:     { label: "Borrador",   tone: "neutral" },
  SCHEDULED: { label: "Programada", tone: "info" },
  SENDING:   { label: "Enviando",   tone: "warning" },
  COMPLETED: { label: "Completada", tone: "success" },
  FAILED:    { label: "Fallida",    tone: "danger" },
};

// Antes esta página tenía "Campañas" y "Automatización" como pestañas
// internas (mismo componente, useState) — se separaron en rutas propias
// (esta = envíos masivos manuales, /whatsapp/campanas/automatizacion = Facebook
// Ads) para que cada una sea un ítem de navegación real con su propia URL
// (bookmarkable, resaltado correcto en el sidebar) en vez de un estado de UI
// invisible para el router. De paso resuelve de raíz el bug donde el
// breadcrumb enlazaba a /whatsapp/campanas/automatizacion sin que existiera
// una página ahí — Next.js caía al sibling dinámico [id] y mostraba "Campaña
// no encontrada" (ver app/components/ui/breadcrumb.tsx).
export default function CampaignsPage() {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; phoneNumber: string | null }>>([]);
  const [accountFilter, setAccountFilter] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  // Cuentas para el selector — mismo patrón que chat-workspace.tsx: de la API,
  // no derivadas de `campaigns` (con el filtro puesto, la lista en memoria
  // sería de una sola cuenta y el selector perdería las demás opciones).
  useEffect(() => {
    fetch("/api/whatsapp/accounts")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) {
          setAccounts(d.map((a: { id: string; name: string; phoneNumber: string | null }) => ({
            id: a.id, name: a.name, phoneNumber: a.phoneNumber ?? null,
          })));
        }
      })
      .catch(() => {});
  }, []);

  const fetchCampaigns = useCallback(async (accountId: string) => {
    setLoading(true);
    try {
      const params = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
      const res = await fetch(`/api/whatsapp/campaigns${params}`);
      const data = await res.json();
      if (Array.isArray(data)) setCampaigns(data);
    } catch {
      toastError("Error al cargar campañas");
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount y en cada cambio de filtro
  useEffect(() => { fetchCampaigns(accountFilter); }, [fetchCampaigns, accountFilter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- keeps pagination valid when the account filter narrows/widens the result set
  useEffect(() => { setPage(1); }, [accountFilter]);

  const totalPages = Math.max(1, Math.ceil(campaigns.length / PAGE_SIZE));
  const pageRows = useMemo(
    () => campaigns.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [campaigns, page]
  );

  // Resumen del conjunto filtrado — solo campañas ya enviadas (DRAFT/SCHEDULED
  // no tienen envíos que sumar todavía). Se calcula sobre lo que ya está en
  // memoria (misma respuesta que alimenta la lista), no un endpoint aparte.
  const summaryKpis: KpiItem[] = useMemo(() => {
    const sent = campaigns.reduce((acc, c) => acc + c.sentCount, 0);
    const delivered = campaigns.reduce((acc, c) => acc + c.deliveredCount, 0);
    const read = campaigns.reduce((acc, c) => acc + c.readCount, 0);
    const failed = campaigns.reduce((acc, c) => acc + c.failedCount, 0);
    const totalCost = campaigns.reduce((acc, c) => acc + c.totalCostUsd, 0);
    const attempted = delivered + read + failed; // "leídos" implica entregado, no se duplica
    const deliveryRate = attempted > 0 ? Math.round(((delivered + read) / attempted) * 100) : null;
    return [
      { label: "Campañas", value: String(campaigns.length), numeric: campaigns.length },
      { label: "Enviados", value: sent.toLocaleString("es-MX"), numeric: sent },
      { label: "Entregados", value: delivered.toLocaleString("es-MX"), numeric: delivered },
      { label: "Leídos", value: read.toLocaleString("es-MX"), numeric: read },
      { label: "Fallidos", value: failed.toLocaleString("es-MX"), numeric: failed },
      { label: "Tasa entrega", value: deliveryRate != null ? `${deliveryRate}%` : "—" },
      { label: "Gasto", value: formatUsd(totalCost), numeric: totalCost },
    ];
  }, [campaigns]);

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/whatsapp/campaigns/${deleteId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Error al eliminar");
      }
      success("Campaña eliminada");
      setCampaigns((prev) => prev.filter((c) => c.id !== deleteId));
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error");
    } finally {
      setDeleteId(null);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      <PageHeader
        title="Campañas Masivas"
        description="Envía mensajes masivos a una lista de destinatarios usando una plantilla aprobada de WhatsApp, manualmente o programados a una fecha."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {accounts.length > 1 ? (
          <Select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="w-64"
            aria-label="Filtrar campañas por cuenta"
          >
            <option value="">Todas las cuentas</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name}{acc.phoneNumber ? ` · ${acc.phoneNumber}` : ""}
              </option>
            ))}
          </Select>
        ) : (
          <span />
        )}
        <Button href="/whatsapp/campanas/nueva" icon={Plus} size="sm">Nueva campaña</Button>
      </div>

      {!loading && campaigns.length > 0 && (
        <div className="border-b border-border pb-4">
          <KpiStrip items={summaryKpis} size="compact" />
        </div>
      )}

      <EntityList
        rows={pageRows}
        rowKey={(c) => c.id}
        loading={loading}
        emptyIcon={Megaphone}
        emptyTitle="Sin campañas"
        emptyDescription="Crea tu primera campaña de WhatsApp para enviar mensajes a múltiples destinatarios."
        onRowClick={(c) => router.push(`/whatsapp/campanas/${c.id}`)}
        renderRow={(c) => {
          const badge = STATUS_BADGE[c.status] ?? { label: c.status, tone: "neutral" as const };
          const progress = c.recipientCount > 0
            ? Math.round((c.sentCount / c.recipientCount) * 100)
            : 0;
          return (
            <>
              <EntityRow
                leading={<EntityAvatar id={c.waAccount.id} name={c.name} size="sm" />}
                title={
                  <Link
                    href={`/whatsapp/campanas/${c.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="hover:text-accent transition-colors"
                  >
                    {c.name}
                  </Link>
                }
                badges={<Badge tone={badge.tone} size="sm">{badge.label}</Badge>}
                subtitle={
                  <>
                    {c.waAccount.name} · Plantilla: {c.waTemplate.name}
                    {c.status !== "DRAFT" && (
                      <>
                        {" "}· Env: {c.sentCount} · Entr: {c.deliveredCount} · Leídos: {c.readCount}
                        {c.failedCount > 0 && <span className="text-danger"> · Fallos: {c.failedCount}</span>}
                        {" "}· Gasto: {formatUsd(c.totalCostUsd)}
                      </>
                    )}
                  </>
                }
                meta={
                  c.status !== "DRAFT" ? (
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-light">
                        <span
                          className="block h-full rounded-full bg-accent transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </span>
                      <span className="font-mono">{progress}%</span>
                    </span>
                  ) : undefined
                }
              />
              {c.status === "DRAFT" && (
                <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Trash2}
                    onClick={() => setDeleteId(c.id)}
                    className="text-muted-darker hover:text-danger"
                    title="Eliminar borrador"
                  />
                </span>
              )}
            </>
          );
        }}
      />

      {totalPages > 1 && (
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} className="justify-center" />
      )}

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Eliminar campaña"
        description="Solo se pueden eliminar campañas en borrador."
        confirmLabel="Eliminar"
        tone="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
