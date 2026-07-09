"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Info, QrCode, AlertTriangle } from "lucide-react";
import { Card, CardBody, CardFooter } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { FormField } from "@/app/components/ui/form-field";
import { Banner } from "@/app/components/ui/banner";
import { Spinner } from "@/app/components/ui/spinner";
import { useToast } from "@/app/components/ui/toast";

function BaileysPairing() {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [qrExpired, setQrExpired] = useState(false);
  const attemptsRef = useRef(0);

  const MAX_POLL_ATTEMPTS = 60; // ~2 min a 2s por intento

  const pollStatus = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/whatsapp/accounts/baileys/${id}/status`);
      const data = await res.json();
      setStatus(data.status);
      if (data.qr) {
        const { default: QRCode } = await import("qrcode");
        const dataUrl = await QRCode.toDataURL(data.qr, { width: 280 });
        setQrImage(dataUrl);
      } else {
        setQrImage(null);
      }
      if (data.status === "CONNECTED") {
        success("Cuenta conectada exitosamente");
        router.push("/whatsapp/cuentas");
      } else if (data.status === "DISCONNECTED") {
        toastError(data.errorMessage ?? "La conexión falló");
      }
    } catch {
      // silent — polling retries on the next tick
    }
  }, [router, success, toastError]);

  useEffect(() => {
    if (!accountId || status === "CONNECTED" || qrExpired) return;
    attemptsRef.current = 0;
    const interval = setInterval(() => {
      attemptsRef.current += 1;
      if (attemptsRef.current > MAX_POLL_ATTEMPTS) {
        clearInterval(interval);
        setQrExpired(true);
        return;
      }
      pollStatus(accountId);
    }, 2000);
    return () => clearInterval(interval);
  }, [accountId, status, qrExpired, pollStatus]);

  async function handleStart() {
    if (!name.trim()) {
      toastError("El nombre es requerido");
      return;
    }
    setStarting(true);
    setQrExpired(false);
    try {
      const res = await fetch("/api/whatsapp/accounts/baileys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al iniciar la conexión");
      setAccountId(data.id);
      setStatus(data.status);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al iniciar la conexión");
    } finally {
      setStarting(false);
    }
  }

  function handleRetryQr() {
    setAccountId(null);
    setQrImage(null);
    setStatus(null);
    setQrExpired(false);
  }

  return (
    <Card>
      <CardBody>
        <div className="space-y-5">
          <Banner tone="warning" title="Solo para pruebas de desarrollo">
            WhatsApp Web (Baileys) reimplementa el protocolo de forma no oficial — WhatsApp puede
            banear o limitar el número usado. Úsalo únicamente con un número desechable, nunca con
            el número de producción de un cliente.
          </Banner>

          {!accountId ? (
            <FormField label="Nombre de la cuenta" required hint="Un nombre descriptivo para identificar esta conexión de prueba">
              {(id) => (
                <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Prueba local" />
              )}
            </FormField>
          ) : qrExpired ? (
            <div className="flex flex-col items-center gap-4 py-8">
              <Banner tone="warning" title="Código QR expirado">
                No se detectó la conexión a tiempo. Genera un nuevo código para volver a intentar.
              </Banner>
              <Button type="button" variant="secondary" onClick={handleRetryQr}>
                Generar nuevo código
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-4">
              {qrImage ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- local data: URL generated client-side, not a remote image next/image can optimize */}
                  <img src={qrImage} alt="Código QR de WhatsApp Web" className="rounded-lg border border-border" />
                  <p className="text-sm text-muted-darker text-center">
                    Abre WhatsApp en tu teléfono de prueba → Dispositivos vinculados → Vincular un dispositivo, y escanea este código.
                  </p>
                </>
              ) : (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Spinner />
                  <p className="text-sm text-muted-darker">
                    {status === "DISCONNECTED" ? "La conexión falló. Vuelve a intentar." : "Generando código QR..."}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </CardBody>
      <CardFooter>
        {!accountId && (
          <Button icon={starting ? undefined : QrCode} onClick={handleStart} disabled={starting}>
            {starting ? <Spinner /> : "Generar código QR"}
          </Button>
        )}
        <Link href="/whatsapp/cuentas">
          <Button type="button" variant="secondary">Cancelar</Button>
        </Link>
      </CardFooter>
    </Card>
  );
}

export default function NuevaCuentaPage() {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [channel, setChannel] = useState<"META_CLOUD" | "BAILEYS">("META_CLOUD");

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
          Conecta un número de WhatsApp usando la API de Meta o, solo para pruebas, WhatsApp Web.
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={channel === "META_CLOUD" ? "primary" : "secondary"}
          onClick={() => setChannel("META_CLOUD")}
        >
          Meta Cloud API
        </Button>
        <Button
          type="button"
          size="sm"
          variant={channel === "BAILEYS" ? "primary" : "secondary"}
          icon={AlertTriangle}
          onClick={() => setChannel("BAILEYS")}
        >
          WhatsApp Web (solo pruebas)
        </Button>
      </div>

      {channel === "BAILEYS" ? (
        <BaileysPairing />
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
