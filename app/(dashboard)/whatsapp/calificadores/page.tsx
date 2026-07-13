"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Target, Trash2, Pencil } from "lucide-react";
import { Card, CardBody } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Switch } from "@/app/components/ui/switch";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { DropdownItem } from "@/app/components/ui/dropdown";
import { PageHeader } from "@/app/components/ui/page-header";
import { Table, type TableColumn } from "@/app/components/ui/table";
import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import { LeadScorerFormModal } from "./_form";

interface LeadScorerBot {
  id: string;
  name: string;
  provider: string;
  model: string;
  systemPrompt: string;
  isActive: boolean;
  updatedAt: string;
}

const PROVIDER_BADGE: Record<string, { label: string; tone: "accent" | "info" }> = {
  openrouter: { label: "OpenRouter", tone: "accent" },
  google: { label: "Gemini", tone: "info" },
};

export default function CalificadoresPage() {
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
    <div className="space-y-6">
      <PageHeader
        title="Calificadores de Leads"
        description="Crea agentes de IA que analizan una conversación y la califican con tu propio criterio — cada uno con su prompt libre, para el negocio que vendas."
        actions={
          <Button icon={Plus} size="sm" onClick={() => { setEditId(null); setModalOpen(true); }}>
            Crear calificador
          </Button>
        }
      />

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
    </div>
  );
}
