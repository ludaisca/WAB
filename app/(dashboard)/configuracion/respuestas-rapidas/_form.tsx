"use client";

import { useState, useEffect, useCallback } from "react";
import { Modal } from "@/app/components/ui/modal";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { FormField } from "@/app/components/ui/form-field";
import { Banner } from "@/app/components/ui/banner";
import { Spinner } from "@/app/components/ui/spinner";
import { useToast } from "@/app/components/ui/toast";

interface CannedResponse {
  id: string;
  shortcut: string;
  content: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  waAccountId: string;
  initialData?: CannedResponse | null;
  onSaved: () => void;
}

export function CannedResponseFormModal({ open, onClose, waAccountId, initialData = null, onSaved }: Props) {
  const isEditing = !!initialData;
  const { success } = useToast();

  const [shortcut, setShortcut] = useState("");
  const [content, setContent] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const resetForm = useCallback(() => {
    setShortcut(initialData?.shortcut ?? "");
    setContent(initialData?.content ?? "");
    setErrors({});
    setError("");
  }, [initialData]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync form fields when the modal opens or the entity being edited changes
    if (open) resetForm();
  }, [open, resetForm]);

  function handleClose() {
    onClose();
  }

  async function handleSubmit() {
    const newErrors: Record<string, string> = {};
    if (!shortcut.trim()) newErrors.shortcut = "Requerido";
    else if (/\s/.test(shortcut.trim())) newErrors.shortcut = "Sin espacios";
    if (!content.trim()) newErrors.content = "Requerido";
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setError("");
    setSaving(true);
    try {
      const url = isEditing ? `/api/whatsapp/canned-responses/${initialData!.id}` : "/api/whatsapp/canned-responses";
      const res = await fetch(url, {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEditing
            ? { shortcut: shortcut.trim(), content: content.trim() }
            : { waAccountId, shortcut: shortcut.trim(), content: content.trim() }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al guardar");

      success(isEditing ? "Respuesta rápida actualizada" : "Respuesta rápida creada");
      onClose();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isEditing ? "Editar respuesta rápida" : "Nueva respuesta rápida"}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner /> : isEditing ? "Actualizar" : "Crear"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Banner tone="danger">{error}</Banner>}

        <FormField label="Atajo" required error={errors.shortcut} hint="Se usa escribiendo / seguido del atajo en el chat, ej: /gracias">
          {(id) => (
            <Input
              id={id}
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
              placeholder="gracias"
              error={errors.shortcut}
            />
          )}
        </FormField>

        <FormField label="Contenido" required error={errors.content}>
          {(id) => (
            <Textarea
              id={id}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Gracias por contactarnos, en breve te atendemos."
              rows={4}
              error={errors.content}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
}
