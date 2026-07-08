"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Info } from "lucide-react";
import { Card, CardTitle, CardBody, CardFooter } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { FormField } from "@/app/components/ui/form-field";
import { Banner } from "@/app/components/ui/banner";
import { Spinner } from "@/app/components/ui/spinner";
import { useToast } from "@/app/components/ui/toast";

export default function NuevaCuentaPage() {
  const router = useRouter();
  const { success, error: toastError } = useToast();

  const [name, setName] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError("");

    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "El nombre es requerido";
    if (!phoneNumberId.trim()) newErrors.phoneNumberId = "El Phone Number ID es requerido";
    else if (!/^\d+$/.test(phoneNumberId.trim())) newErrors.phoneNumberId = "Debe ser un ID numérico";
    if (!accessToken.trim()) newErrors.accessToken = "El token de acceso es requerido";
    if (!verifyToken.trim()) newErrors.verifyToken = "El verify token es requerido";
    else if (verifyToken.trim().length < 6) newErrors.verifyToken = "Mínimo 6 caracteres";
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
          verifyToken: verifyToken.trim(),
          appSecret: appSecret.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Error al conectar la cuenta");
      }

      success("Cuenta conectada exitosamente");
      router.push("/whatsapp/cuentas");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al conectar la cuenta";
      setApiError(msg);
      toastError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <Link href="/whatsapp/cuentas" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors mb-3">
          <ArrowLeft size={14} />
          Volver a cuentas
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Agregar número</h1>
        <p className="mt-1 text-sm text-muted">
          Conecta un número de WhatsApp Business API usando tus credenciales de Meta.
        </p>
      </div>

      {apiError && (
        <Banner tone="danger" title="Error de conexión" onClose={() => setApiError("")}>
          {apiError}
        </Banner>
      )}

      <Card>
        <form onSubmit={handleSubmit}>
          <CardBody>
            <div className="space-y-5">
              <FormField label="Nombre de la cuenta" required error={errors.name} hint="Un nombre descriptivo para identificar este número">
                {(id) => (
                  <Input
                    id={id}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej: Soporte Ventas"
                    error={errors.name}
                  />
                )}
              </FormField>

              <FormField label="Phone Number ID" required error={errors.phoneNumberId} hint="El ID del número registrado en Meta (ej: 123456789012345)">
                {(id) => (
                  <Input
                    id={id}
                    value={phoneNumberId}
                    onChange={(e) => setPhoneNumberId(e.target.value)}
                    placeholder="123456789012345"
                    error={errors.phoneNumberId}
                  />
                )}
              </FormField>

              <FormField label="Token de acceso" required error={errors.accessToken} hint="Token de acceso permanente generado en Meta for Developers">
                {(id) => (
                  <Textarea
                    id={id}
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder="EAA..."
                    rows={3}
                  />
                )}
              </FormField>

              <FormField label="WABA ID" error={errors.wabaId} hint="Opcional — ID de la cuenta de WhatsApp Business (ej: 987654321098765)">
                {(id) => (
                  <Input
                    id={id}
                    value={wabaId}
                    onChange={(e) => setWabaId(e.target.value)}
                    placeholder="987654321098765"
                    error={errors.wabaId}
                  />
                )}
              </FormField>

              <FormField label="Verify Token" required error={errors.verifyToken} hint="Token que Meta usará para verificar el webhook. Debes copiar este mismo valor en la configuración del webhook de tu App de Meta.">
                {(id) => (
                  <Input
                    id={id}
                    value={verifyToken}
                    onChange={(e) => setVerifyToken(e.target.value)}
                    placeholder="mi-token-secreto-123"
                    error={errors.verifyToken}
                  />
                )}
              </FormField>

              <FormField label="App Secret (opcional)" hint="Secreto de la App de Meta para validar firmas de webhook entrantes">
                {(id) => (
                  <Input
                    id={id}
                    value={appSecret}
                    onChange={(e) => setAppSecret(e.target.value)}
                    placeholder="abc123..."
                  />
                )}
              </FormField>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-info-bg border border-info-border">
                <Info size={18} className="text-info shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-foreground">Configuración del webhook en Meta</p>
                  <p className="text-muted-darker mt-1">
                    En tu App de Meta, configura el webhook con la URL:{" "}
                    <code className="text-xs bg-surface px-1.5 py-0.5 rounded font-mono">
                      {typeof window !== "undefined" ? `${window.location.origin}/api/whatsapp/webhook` : "/api/whatsapp/webhook"}
                    </code>
                  </p>
                  <p className="text-muted-darker mt-1">
                    El Verify Token debe ser el mismo que ingresas arriba. Suscríbete a los campos{" "}
                    <strong>messages</strong> y <strong>message_template_status_update</strong>.
                  </p>
                </div>
              </div>
            </div>
          </CardBody>

          <CardFooter>
            <Button type="submit" icon={saving ? undefined : Save} disabled={saving}>
              {saving ? <Spinner /> : "Conectar cuenta"}
            </Button>
            <Link href="/whatsapp/cuentas">
              <Button type="button" variant="secondary">
                Cancelar
              </Button>
            </Link>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
