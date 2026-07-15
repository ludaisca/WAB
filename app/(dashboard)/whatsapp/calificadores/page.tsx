"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Plus, Target, Trash2, Pencil, Sparkles, Clock } from "lucide-react";
import { Card, CardBody } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Switch } from "@/app/components/ui/switch";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { DropdownItem } from "@/app/components/ui/dropdown";
import { PageHeader } from "@/app/components/ui/page-header";
import { Table, type TableColumn } from "@/app/components/ui/table";
import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { useToast } from "@/app/components/ui/toast";
import { LeadScorerFormModal } from "./_form";

interface LeadScorerBot {
  id: string;
  name: string;
  provider: string;
  model: string;
  systemPrompt: string;
  isActive: boolean;
  scheduleEnabled: boolean;
  scheduleIntervalMinutes: number | null;
  updatedAt: string;
}

interface LeadScoreRow {
  id: string;
  score: number;
  label: "frio" | "tibio" | "caliente";
  summary: string;
  updatedAt: string;
  scorer: { id: string; name: string };
  chat: {
    id: string;
    name: string | null;
    remoteJid: string;
    status: string;
    accountId: string;
    account: { id: string; name: string };
  };
}

const PROVIDER_BADGE: Record<string, { label: string; tone: "accent" | "info" }> = {
  openrouter: { label: "OpenRouter", tone: "accent" },
  google: { label: "Gemini", tone: "info" },
};

const INTERVAL_LABEL: Record<number, string> = {
  15: "15 min",
  30: "30 min",
  60: "1 h",
  180: "3 h",
  360: "6 h",
  720: "12 h",
  1440: "24 h",
};

const LABEL_TONE: Record<LeadScoreRow["label"], "info" | "warning" | "danger"> = {
  frio: "info",
  tibio: "warning",
  caliente: "danger",
};

const LABEL_TEXT: Record<LeadScoreRow["label"], string> = {
  frio: "Frío",
  tibio: "Tibio",
  caliente: "Caliente",
};

const TABS = ["calificadores", "leads"] as const;
type Tab = (typeof TABS)[number];

export default function CalificadoresPage() {
  const [tab, setTab] = useState<Tab>("calificadores");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calificadores de Leads"
        description="Crea agentes de IA que analizan una conversación y la califican con tu propio criterio — cada uno con su prompt libre, para el negocio que vendas."
      />

      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t === "calificadores" ? "Calificadores" : "Leads calificados"}
          </button>
        ))}
      </div>

      {tab === "calificadores" ? <CalificadoresTab /> : <LeadsTab />}
    </div>
  );
}

function CalificadoresTab() {
  const { success, error: toastError } = useToast();
  const [items, setItems] = useState<LeadScorerBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/whatsapp/lead-scorers");
      const data = await res.json();
      if (Array.isArray(data)) setItems(data);
      else throw new Error(data.error ?? "Error al cargar calificadores");
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Error al cargar calificadores");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; fetchItems also used for manual refresh
    fetchItems();
  }, [fetchItems]);

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/whatsapp/lead-scorers/${deleteId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Error al eliminar");
      }
      success("Calificador eliminado");
      setItems((prev) => prev.filter((i) => i.id !== deleteId));
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al eliminar");
    } finally {
      setDeleteId(null);
    }
  }

  const handleToggle = useCallback(async (item: LeadScorerBot) => {
    setTogglingId(item.id);
    try {
      const res = await fetch(`/api/whatsapp/lead-scorers/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !item.isActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al actualizar");
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isActive: data.isActive } : i)));
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al actualizar");
    } finally {
      setTogglingId(null);
    }
  }, [toastError]);

  const columns: TableColumn<LeadScorerBot>[] = useMemo(() => [
    {
      key: "name",
      header: "Nombre",
      render: (r) => <span className="text-sm font-medium text-foreground">{r.name}</span>,
    },
    {
      key: "provider",
      header: "Proveedor / Modelo",
      render: (r) => {
        const provider = PROVIDER_BADGE[r.provider] ?? { label: r.provider, tone: "info" as const };
        return (
          <div className="flex items-center gap-2">
            <Badge tone={provider.tone} size="sm">{provider.label}</Badge>
            <span className="text-xs text-muted-darker">{r.model}</span>
          </div>
        );
      },
    },
    {
      key: "prompt",
      header: "Prompt",
      render: (r) => <span className="text-sm text-muted-darker line-clamp-1">{r.systemPrompt}</span>,
    },
    {
      key: "schedule",
      header: "Automático",
      render: (r) =>
        r.scheduleEnabled && r.scheduleIntervalMinutes ? (
          <Badge tone="accent" size="sm" icon={Clock}>
            {INTERVAL_LABEL[r.scheduleIntervalMinutes] ?? `${r.scheduleIntervalMinutes} min`}
          </Badge>
        ) : (
          <span className="text-xs text-muted-darker">—</span>
        ),
    },
    {
      key: "isActive",
      header: "Activo",
      render: (r) => (
        <Switch
          checked={r.isActive}
          onCheckedChange={() => handleToggle(r)}
          disabled={togglingId === r.id}
        />
      ),
    },
  ], [togglingId, handleToggle]);

  return (
    <>
      <div className="flex justify-end">
        <Button icon={Plus} size="sm" onClick={() => { setEditId(null); setModalOpen(true); }}>
          Crear calificador
        </Button>
      </div>

      <Card>
        <CardBody>
          <Table
            columns={columns}
            rows={items}
            rowKey={(r) => r.id}
            loading={loading}
            error={fetchError}
            onRetry={fetchItems}
            emptyIcon={Target}
            emptyTitle="Sin calificadores"
            emptyDescription="Crea tu primer calificador para empezar a calificar leads desde los chats."
            rowActions={(r) => (
              <>
                <DropdownItem icon={Pencil} onClick={() => { setEditId(r.id); setModalOpen(true); }}>
                  Editar
                </DropdownItem>
                <DropdownItem icon={Trash2} onClick={() => setDeleteId(r.id)}>
                  Eliminar
                </DropdownItem>
              </>
            )}
          />
        </CardBody>
      </Card>

      <LeadScorerFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editId={editId}
        onSaved={fetchItems}
      />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Eliminar calificador"
        description="Esta acción eliminará el calificador y todos los scores que haya generado en cualquier chat. No se puede deshacer."
        confirmLabel="Eliminar"
        tone="danger"
        onConfirm={handleDelete}
      />
    </>
  );
}

function LeadsTab() {
  const { error: toastError } = useToast();
  const [rows, setRows] = useState<LeadScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [scorerFilter, setScorerFilter] = useState("all");
  const [labelFilter, setLabelFilter] = useState("all");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/whatsapp/lead-scores");
      const data = await res.json();
      if (Array.isArray(data)) setRows(data);
      else throw new Error(data.error ?? "Error al cargar leads calificados");
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Error al cargar leads calificados");
      toastError(err instanceof Error ? err.message : "Error al cargar leads calificados");
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    fetchRows();
  }, [fetchRows]);

  const scorers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) seen.set(r.scorer.id, r.scorer.name);
    return Array.from(seen.entries());
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (scorerFilter !== "all" && r.scorer.id !== scorerFilter) return false;
      if (labelFilter !== "all" && r.label !== labelFilter) return false;
      return true;
    });
  }, [rows, scorerFilter, labelFilter]);

  const columns: TableColumn<LeadScoreRow>[] = useMemo(() => [
    {
      key: "chat",
      header: "Lead",
      render: (r) => (
        <Link
          href={`/whatsapp/chat/${r.chat.accountId}/${r.chat.id}`}
          className="font-medium hover:text-accent transition-colors"
        >
          {r.chat.name || r.chat.remoteJid.split("@")[0]}
        </Link>
      ),
    },
    {
      key: "account",
      header: "Cuenta",
      render: (r) => <span className="text-xs text-muted-darker">{r.chat.account.name}</span>,
    },
    {
      key: "label",
      header: "Calificación",
      render: (r) => <Badge tone={LABEL_TONE[r.label]} size="sm">{LABEL_TEXT[r.label]} · {r.score}/100</Badge>,
    },
    {
      key: "scorer",
      header: "Calificador",
      render: (r) => <span className="text-xs text-muted-darker">{r.scorer.name}</span>,
    },
    {
      key: "summary",
      header: "Resumen",
      render: (r) => <span className="text-sm text-muted-darker line-clamp-1">{r.summary}</span>,
    },
    {
      key: "updatedAt",
      header: "Actualizado",
      headerClassName: "text-right",
      cellClassName: "text-right",
      render: (r) => (
        <span className="text-xs text-muted-darker">
          {new Date(r.updatedAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
        </span>
      ),
    },
  ], []);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-56">
          <Select value={scorerFilter} onChange={(e) => setScorerFilter(e.target.value)}>
            <option value="all">Todos los calificadores</option>
            {scorers.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </Select>
        </div>
        <div className="w-48">
          <Select value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)}>
            <option value="all">Todas las calificaciones</option>
            <option value="caliente">Caliente</option>
            <option value="tibio">Tibio</option>
            <option value="frio">Frío</option>
          </Select>
        </div>
      </div>

      <Card>
        <CardBody>
          <Table
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            loading={loading}
            error={fetchError}
            onRetry={fetchRows}
            emptyIcon={Sparkles}
            emptyTitle="Sin leads calificados"
            emptyDescription="Los chats que califiques manualmente o mediante ejecución automática aparecerán aquí."
          />
        </CardBody>
      </Card>
    </>
  );
}
