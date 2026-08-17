"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Handshake } from "lucide-react";
import { EntityList, EntityRow } from "@/app/components/ui/entity-list";
import { EntityAvatar } from "@/app/components/ui/avatar";
import { Badge } from "@/app/components/ui/badge";
import { Switch } from "@/app/components/ui/switch";
import { Button } from "@/app/components/ui/button";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { DropdownItem } from "@/app/components/ui/dropdown";
import { useToast } from "@/app/components/ui/toast";
import { ExecutiveFormModal } from "./_executive-form";

export interface TrackedExecutiveItem {
  id: string;
  phone: string;
  label: string;
  active: boolean;
  updatedAt: string;
  _count: { prospects: number };
}

export function ExecutivesTab() {
  const { success, error: toastError } = useToast();
  const [items, setItems] = useState<TrackedExecutiveItem[]>([]);
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
      const res = await fetch("/api/crm-ejecutivos/tracked-executives");
      const data = await res.json();
      if (Array.isArray(data)) setItems(data);
      else throw new Error(data.error ?? "Error al cargar ejecutivos");
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Error al cargar ejecutivos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; fetchItems también se usa para refrescar manualmente
    fetchItems();
  }, [fetchItems]);

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/crm-ejecutivos/tracked-executives/${deleteId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Error al eliminar");
      }
      success("Ejecutivo eliminado (junto con su copia local de prospectos)");
      setItems((prev) => prev.filter((i) => i.id !== deleteId));
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al eliminar");
    } finally {
      setDeleteId(null);
    }
  }

  const handleToggle = useCallback(async (item: TrackedExecutiveItem) => {
    setTogglingId(item.id);
    try {
      const res = await fetch(`/api/crm-ejecutivos/tracked-executives/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !item.active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al actualizar");
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, active: data.active } : i)));
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al actualizar");
    } finally {
      setTogglingId(null);
    }
  }, [toastError]);

  return (
    <>
      <div className="flex justify-end">
        <Button icon={Plus} size="sm" onClick={() => { setEditId(null); setModalOpen(true); }}>
          Agregar ejecutivo
        </Button>
      </div>

      <EntityList
        rows={items}
        rowKey={(r) => r.id}
        loading={loading}
        error={fetchError}
        onRetry={fetchItems}
        emptyIcon={Handshake}
        emptyTitle="Sin ejecutivos monitoreados"
        emptyDescription="Agrega el teléfono de un ejecutivo del CRM externo para empezar a sincronizar sus prospectos."
        onRowClick={(r) => { setEditId(r.id); setModalOpen(true); }}
        renderRow={(r) => (
          <>
            <EntityRow
              leading={<EntityAvatar id={r.id} name={r.label} size="sm" />}
              title={r.label}
              subtitle={r.phone}
              badges={<Badge tone="neutral" size="sm">{r._count.prospects} prospecto{r._count.prospects === 1 ? "" : "s"}</Badge>}
            />
            <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={r.active}
                onCheckedChange={() => handleToggle(r)}
                disabled={togglingId === r.id}
              />
            </span>
          </>
        )}
        rowActions={(r) => (
          <DropdownItem icon={Trash2} danger onClick={() => setDeleteId(r.id)}>
            Eliminar
          </DropdownItem>
        )}
      />

      <ExecutiveFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editItem={items.find((i) => i.id === editId) ?? null}
        onSaved={fetchItems}
      />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Eliminar ejecutivo monitoreado"
        description="Se dejará de sincronizar y se borrará también su copia local de prospectos. No afecta nada en el CRM externo."
        confirmLabel="Eliminar"
        tone="danger"
        onConfirm={handleDelete}
      />
    </>
  );
}
