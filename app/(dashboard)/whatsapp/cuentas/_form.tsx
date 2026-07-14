"use client";

import { useState, useCallback } from "react";
import { Copy, Check, Info } from "lucide-react";
import { Modal } from "@/app/components/ui/modal";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { FormField } from "@/app/components/ui/form-field";
import { Banner } from "@/app/components/ui/banner";
import { Spinner } from "@/app/components/ui/spinner";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const WEBHOOK_PATH = "/api/whatsapp/webhook";

export function CuentaFormModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState("");
  const [verifyToken, setVerifyToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<"webhook" | "token" | null>(null);

  const resetForm = useCallback(() => {
    setName("");
    setPhoneNumberId("");
    setAccessToken("");
    setWabaId("");
    setAppSecret("");
    setErrors({});
    setApiError("");
    setVerifyToken(null);
    setCopied(null);
  }, []);

  function getWebhookUrl() {
    return typeof window !== "undefined" ? `${window.location.origin}${WEBHOOK_PATH}` : WEBHOOK_PATH;
  }

  async function handleCopy(text: string, which: "webhook" | "token") {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError("");

    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "El nombre es requerido";
    if (!phoneNumberId.trim()) newErrors.phoneNumberId = "El Phone Number ID es requerido";
    else if (!/^\d+$/.test(phoneNumberId.trim())) newErrors.phoneNumberId = "Debe ser un ID numérico";
    if (!accessToken.trim()) newErrors.accessToken = "El token de acceso es requerido";
    if (wabaId.trim() && !/^\d+$/.test(wabaId.trim())) newErrors.wabaId = "Debe ser un ID numérico";

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setSaving(true);
    try {
      const res = await fetch("/api/whatsapp/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phoneNumberId: phoneNumberId.trim(),
          accessToken: accessToken.trim(),
          wabaId: wabaId.trim() || undefined,
          appSecret: appSecret.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al conectar la cuenta");

      // Verify token is only ever returned this once (stored hashed from here on) —
      // keep the modal open on a success step so the user can copy it before closing.
      setVerifyToken(data.verifyToken);
      onCreated();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Error al conectar la cuenta");
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  if (verifyToken) {
    return (
      <Modal
        open={open}
        onClose={handleClose}
        title="Cuenta conectada"
        description="Copia estos valores en la configuración del webhook de tu App de Meta. El verify token no se puede volver a mostrar."
        size="md"
        footer={<Button onClick={handleClose}>Listo</Button>}
      >
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-darker uppercase tracking-wider mb-1.5">URL del webhook</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-surface px-3 py-2 rounded-lg text-xs font-mono break-all">
                {getWebhookUrl()}
              </code>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={copied === "webhook" ? Check : Copy}
                onClick={() => handleCopy(getWebhookUrl(), "webhook")}
              >
                {copied === "webhook" ? "Copiado" : "Copiar"}
              </Button>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-darker uppercase tracking-wider mb-1.5">Verify token</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-surface px-3 py-2 rounded-lg text-xs font-mono break-all">
                {verifyToken}
              </code>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={copied === "token" ? Check : Copy}
                onClick={() => handleCopy(verifyToken, "token")}
              >
                {copied === "token" ? "Copiado" : "Copiar"}
              </Button>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-lg bg-info-bg border border-info-border">
            <Info size={18} className="text-info shrink-0 mt-0.5" />
            <p className="text-sm text-muted-darker">
              Suscríbete a los campos <strong>messages</strong> y <strong>message_template_status_update</strong> en el webhook de tu App de Meta.
            </p>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Agregar número"
      description="Conecta un número de WhatsApp usando la API oficial de Meta Cloud."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner /> : "Conectar cuenta"}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {apiError && <Banner tone="danger">{apiError}</Banner>}

        <FormField label="Nombre de la cuenta" required error={errors.name} hint="Un nombre descriptivo para identificar este número">
          {(id) => (
            <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Soporte Ventas" error={errors.name} />
          )}
        </FormField>

        <FormField label="Phone Number ID" required error={errors.phoneNumberId} hint="El ID del número registrado en Meta (ej: 123456789012345)">
          {(id) => (
            <Input id={id} value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} placeholder="123456789012345" error={errors.phoneNumberId} />
          )}
        </FormField>

        <FormField label="Token de acceso" required error={errors.accessToken} hint="Token de acceso permanente generado en Meta for Developers">
          {(id) => (
            <Textarea id={id} value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="EAA..." rows={3} />
          )}
        </FormField>

        <FormField label="WABA ID" error={errors.wabaId} hint="Opcional — ID de la cuenta de WhatsApp Business (ej: 987654321098765)">
          {(id) => (
            <Input id={id} value={wabaId} onChange={(e) => setWabaId(e.target.value)} placeholder="987654321098765" error={errors.wabaId} />
          )}
        </FormField>

        <FormField label="App Secret (opcional)" hint="Secreto de la App de Meta para validar firmas de webhook entrantes">
          {(id) => (
            <Input id={id} value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder="abc123..." />
          )}
        </FormField>

        <div className="flex items-start gap-3 p-3 rounded-lg bg-info-bg border border-info-border">
          <Info size={18} className="text-info shrink-0 mt-0.5" />
          <p className="text-sm text-muted-darker">
            El verify token para el webhook se genera automáticamente — lo verás al conectar la cuenta.
          </p>
        </div>
      </form>
    </Modal>
  );
}
