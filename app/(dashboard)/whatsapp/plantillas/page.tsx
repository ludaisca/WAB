"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, RefreshCw, MessageSquareText } from "lucide-react";
import { Card, CardBody } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { Badge } from "@/app/components/ui/badge";
import { Spinner } from "@/app/components/ui/spinner";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { Table, type TableColumn } from "@/app/components/ui/table";
import { useToast } from "@/app/components/ui/toast";
import { TemplateFormModal } from "./_form";

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

  const columns: TableColumn<Template>[] = useMemo(() => [
    { key: "name", header: "Nombre", render: (t) => <span className="font-medium">{t.name}</span> },
    { key: "language", header: "Idioma", render: (t) => <span className="text-xs">{t.language}</span>, hideBelow: "sm" },
    { key: "category", header: "Categoría", render: (t) => <span className="text-xs">{t.category}</span>, hideBelow: "md" },
    {
      key: "status",
      header: "Estado",
      render: (t) => {
        const badge = STATUS_BADGE[t.status] ?? { label: t.status, tone: "neutral" as const };
        return <Badge tone={badge.tone} size="sm">{badge.label}</Badge>;
      },
    },
    {
      key: "syncedAt",
      header: "Sincronizada",
      render: (t) => (
        <span className="text-xs text-muted-darker">
          {new Date(t.syncedAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
        </span>
      ),
      hideBelow: "md",
    },
  ], []);

  return (
    <div className="space-y-6 max-w-4xl">
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
        <Card>
          <CardBody>
            <Table
              columns={columns}
              rows={templates}
              rowKey={(t) => t.id}
              loading={loading}
              error={fetchError}
              onRetry={fetchTemplates}
              emptyIcon={MessageSquareText}
              emptyTitle="Sin plantillas"
              emptyDescription="No hay plantillas en esta cuenta. Sincroniza desde Meta o crea una nueva."
            />
          </CardBody>
        </Card>
      )}

      <TemplateFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        accounts={accounts.filter((a) => !!a.wabaId)}
        defaultAccountId={selectedAccountId}
        onCreated={fetchTemplates}
      />
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
