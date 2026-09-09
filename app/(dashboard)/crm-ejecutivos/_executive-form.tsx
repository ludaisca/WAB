"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/app/components/ui/modal";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { FormField } from "@/app/components/ui/form-field";
import { Switch } from "@/app/components/ui/switch";
import { Banner } from "@/app/components/ui/banner";
import { useToast } from "@/app/components/ui/toast";
import type { TrackedExecutiveItem } from "./_executives-tab";

interface Props {
  open: boolean;
  onClose: () => void;
  editItem: TrackedExecutiveItem | null;
  onSaved: () => void;
}

export function ExecutiveFormModal({ open, onClose, editItem, onSaved }: Props) {
  const isEditing = !!editItem;
  const { success } = useToast();

  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");
  const [active, setActive] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga/reset del form al abrir el modal
    setPhone(editItem?.phone ?? "");
    setLabel(editItem?.label ?? "");
    setActive(editItem?.active ?? true);
    setError("");
  }, [open, editItem]);

  async function handleSave() {
    setError("");
    setSaving(true);
    try {
      const url = isEditing ? `/api/crm-ejecutivos/tracked-executives/${editItem.id}` : "/api/crm-ejecutivos/tracked-executives";
      const res = await fetch(url, {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.replace(/\D/g, ""), label, active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al guardar");
      // La sincronización automática (tick cada 15 min) está desactivada a
      // propósito por ahora (ver el bloque comentado en lib/workers/index.ts)
      // — no prometer un refresco que no va a pasar solo.
      success(isEditing ? "Ejecutivo actualizado" : "Ejecutivo agregado — pulsa \"Sincronizar ahora\" para traer sus prospectos (la sincronización automática está desactivada por ahora)");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? "Editar ejecutivo" : "Agregar ejecutivo"}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} loading={saving} disabled={!phone.trim() || !label.trim()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Banner tone="danger">{error}</Banner>}

        <FormField label="Teléfono">
          {(id) => (
            <Input
              id={id}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ej: 5630948880"
            />
          )}
        </FormField>
        <p className="-mt-2 text-xs text-muted-darker">
          Tal cual lo espera el CRM externo (ejecutivephone) — solo dígitos, sin espacios ni +52.
        </p>

        <FormField label="Nombre / etiqueta">
          {(id) => (
            <Input
              id={id}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ej: Israel Trejo"
            />
          )}
        </FormField>

        <FormField label="Activo">
          {(id) => (
            <div id={id} className="flex items-center gap-2">
              <Switch checked={active} onCheckedChange={setActive} />
              <span className="text-sm text-muted-darker">
                {active ? "Incluido al pulsar \"Sincronizar ahora\"" : "Pausado — no se sincroniza"}
              </span>
            </div>
          )}
        </FormField>
      </div>
    </Modal>
  );
}
