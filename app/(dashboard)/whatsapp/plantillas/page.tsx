"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, RefreshCw, MessageSquareText, Search } from "lucide-react";
import { Card, CardBody } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Badge } from "@/app/components/ui/badge";
import { Spinner } from "@/app/components/ui/spinner";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { EntityList, EntityRow } from "@/app/components/ui/entity-list";
import { EntityAvatar } from "@/app/components/ui/avatar";
import { useToast } from "@/app/components/ui/toast";
import { formatDate } from "@/lib/timezone";
import { TemplateFormModal } from "./_form";
import { TemplateMetricsModal } from "@/app/components/whatsapp/template-metrics-modal";

interface Account { id: string; name: string; channel: string; wabaId: string | null; status: string; }

interface Template {
  id: string;
  templateId: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown;
  syncedAt: string;
  createdAt: string;
  waAccountId: string;
}

const STATUS_BADGE: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  PENDING: { label: "Pendiente", tone: "warning" },
  APPROVED: { label: "Aprobada", tone: "success" },
  REJECTED: { label: "Rechazada", tone: "danger" },
  PAUSED: { label: "Pausada", tone: "neutral" },
  DISABLED: { label: "Deshabilitada", tone: "neutral" },
};

function TemplatesContent() {
  const searchParams = useSearchParams();
  const preselectedId = searchParams.get("accountId");
  const { success, error: toastError } = useToast();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [metricsTemplateId, setMetricsTemplateId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    fetch("/api/whatsapp/accounts")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) {
          setAccounts(d.filter((a: Account) => a.channel === "META_CLOUD"));
          if (preselectedId) setSelectedAccountId(preselectedId);
        }
      })
      .catch(() => toastError("Error al cargar cuentas"));
  }, [preselectedId, toastError]);

  const fetchTemplates = useCallback(async () => {
    if (!selectedAccountId) {
      setTemplates([]);
      return;
    }
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/whatsapp/templates?waAccountId=${selectedAccountId}`);
      const data = await res.json();
      if (Array.isArray(data)) setTemplates(data);
      else throw new Error(data.error ?? "Error al cargar plantillas");
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Error al cargar plantillas");
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; fetchTemplates also used for manual refresh
    fetchTemplates();
  }, [fetchTemplates]);

  async function handleSync() {
    if (!selectedAccountId) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/whatsapp/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ waAccountId: selectedAccountId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Error al sincronizar");
      }
      success("Plantillas sincronizadas");
      fetchTemplates();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error");
    } finally {
      setSyncing(false);
    }
  }

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
  const missingWabaId = selectedAccount && !selectedAccount.wabaId;

  const filtered = useMemo(() => templates.filter((t) => {
    const q = search.trim().toLowerCase();
    if (q && !t.name.toLowerCase().includes(q)) return false;
    if (statusFilter && t.status !== statusFilter) return false;
    return true;
  }), [templates, search, statusFilter]);

  return (
    <div className="space-y-6 animate-fade-in-up">
      <PageHeader
        title="Plantillas"
        description="Gestiona las plantillas de mensaje de tus cuentas WhatsApp."
      />

      <div className="flex items-end gap-3 flex-wrap">
        <div className="w-64">
          <Select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            placeholder="Seleccionar cuenta"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} {!a.wabaId ? "(sin WABA ID)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={syncing ? undefined : RefreshCw}
          onClick={handleSync}
          disabled={!selectedAccountId || syncing}
        >
          {syncing ? <Spinner /> : "Sincronizar"}
        </Button>
        <Button
          size="sm"
          icon={Plus}
          onClick={() => setModalOpen(true)}
          disabled={!selectedAccountId || missingWabaId}
        >
          Crear plantilla
        </Button>
      </div>

      {missingWabaId && selectedAccountId && (
        <p className="text-sm text-muted">
          Esta cuenta no tiene WABA ID configurado. Necesitas configurarlo para crear plantillas.
        </p>
      )}

      {!selectedAccountId ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={MessageSquareText}
              title="Selecciona una cuenta"
              description="Elige una cuenta WhatsApp para ver sus plantillas."
            />
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              icon={Search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre..."
              className="sm:max-w-xs flex-1"
            />
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              placeholder="Todos los estados"
              className="sm:max-w-[180px]"
            >
              <option value="">Todos los estados</option>
              {Object.entries(STATUS_BADGE).map(([value, { label }]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </div>

          <EntityList
          rows={filtered}
          rowKey={(t) => t.id}
          loading={loading}
          error={fetchError}
          onRetry={fetchTemplates}
          emptyIcon={MessageSquareText}
          emptyTitle="Sin plantillas"
          emptyDescription={
            templates.length === 0
              ? "No hay plantillas en esta cuenta. Sincroniza desde Meta o crea una nueva."
              : "No se encontraron plantillas con los filtros actuales."
          }
          onRowClick={(t) => setMetricsTemplateId(t.id)}
          renderRow={(t) => {
            const badge = STATUS_BADGE[t.status] ?? { label: t.status, tone: "neutral" as const };
            return (
              <EntityRow
                leading={<EntityAvatar id={t.waAccountId} name={t.name} size="sm" />}
                title={t.name}
                badges={<Badge tone={badge.tone} size="sm">{badge.label}</Badge>}
                subtitle={<>{t.language} · {t.category}</>}
                meta={
                  <>
                    <span className="font-mono">
                      {formatDate(t.syncedAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="text-accent">Ver métricas →</span>
                  </>
                }
              />
            );
          }}
          />
        </div>
      )}

      <TemplateFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        accounts={accounts.filter((a) => !!a.wabaId)}
        defaultAccountId={selectedAccountId}
        onCreated={fetchTemplates}
      />

      <TemplateMetricsModal templateId={metricsTemplateId} onClose={() => setMetricsTemplateId(null)} />
    </div>
  );
}

export default function TemplatesPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-16">
        <Spinner />
      </div>
    }>
      <TemplatesContent />
    </Suspense>
  );
}
