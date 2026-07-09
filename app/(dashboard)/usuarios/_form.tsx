"use client";

import { useState, useCallback } from "react";
import { Modal } from "@/app/components/ui/modal";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { FormField } from "@/app/components/ui/form-field";
import { Banner } from "@/app/components/ui/banner";
import { Spinner } from "@/app/components/ui/spinner";
import { useToast } from "@/app/components/ui/toast";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function UserFormModal({ open, onClose, onCreated }: Props) {
  const { success } = useToast();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [maxOpenChats, setMaxOpenChats] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const resetForm = useCallback(() => {
    setName("");
    setEmail("");
    setPassword("");
    setRole("user");
    setMaxOpenChats("");
    setError("");
    setFieldErrors({});
  }, []);

  function handleClose() {
    resetForm();
    onClose();
  }

  async function handleSubmit() {
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = "Requerido";
    if (!email.trim()) errors.email = "Requerido";
    if (!password || password.length < 6) errors.password = "Mínimo 6 caracteres";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
          role,
          maxOpenChats: maxOpenChats.trim() ? Number(maxOpenChats) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al crear usuario");

      success("Usuario creado");
      resetForm();
      onClose();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear usuario");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Nuevo usuario"
      description="Crea una cuenta de acceso al sistema."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner /> : "Crear"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Banner tone="danger">{error}</Banner>}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Nombre" required error={fieldErrors.name}>
            {(id) => (
              <Input
                id={id}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombre completo"
                error={fieldErrors.name}
              />
            )}
          </FormField>
          <FormField label="Email" required error={fieldErrors.email}>
            {(id) => (
              <Input
                id={id}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@email.com"
                error={fieldErrors.email}
              />
            )}
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Contraseña" required error={fieldErrors.password}>
            {(id) => (
              <Input
                id={id}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                error={fieldErrors.password}
              />
            )}
          </FormField>
          <FormField label="Rol">
            {(id) => (
              <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="user">Usuario</option>
                <option value="ejecutivo">Ejecutivo</option>
                <option value="admin">Admin</option>
              </Select>
            )}
          </FormField>
        </div>
        <FormField label="Máximo de chats abiertos" hint="Opcional — usado por la auto-asignación de chats. Vacío = sin límite.">
          {(id) => (
            <Input
              id={id}
              type="number"
              min="1"
              value={maxOpenChats}
              onChange={(e) => setMaxOpenChats(e.target.value)}
              placeholder="Sin límite"
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
}
