"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Rocket, Upload, ArrowLeft } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, CardFooter } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { PasswordInput } from "@/app/components/ui/password-input";
import { PasswordStrength } from "@/app/components/ui/password-strength";
import { FormField } from "@/app/components/ui/form-field";
import { Banner } from "@/app/components/ui/banner";
import { Logo } from "@/app/components/ui/logo";
import { onboardingSchema } from "@/lib/validations";
import { RestoreConfirmModal } from "@/app/(dashboard)/configuracion/backups/_restore-confirm-modal";
import type { RestorePreviewResponse } from "@/app/(dashboard)/configuracion/backups/_types";

const RESTORE_POLL_MS = 4000;

export function OnboardingForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"create" | "restore">("create");
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");
  const [loading, setLoading] = useState(false);

  // --- Restaurar respaldo en vez de crear cuenta nueva ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<RestorePreviewResponse | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const [restoreLogId, setRestoreLogId] = useState<string | null>(null);
  const [restoreStatus, setRestoreStatus] = useState<"PENDING" | "RUNNING" | null>(null);

  useEffect(() => {
    if (!restoreLogId || !restoreStatus) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/onboarding/restore/${restoreLogId}`);
        const data = await res.json();
        if (!res.ok) return;
        if (data.status === "COMPLETED") {
          router.push("/login?onboarded=1");
        } else if (data.status === "FAILED") {
          setRestoreStatus(null);
          setRestoreLogId(null);
          setRestoreError(data.errorMessage || "La restauración falló.");
        }
      } catch {
        // silencioso — se reintenta en el siguiente tick
      }
    }, RESTORE_POLL_MS);
    return () => clearInterval(interval);
  }, [restoreLogId, restoreStatus, router]);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setRestoreError("");
    setPreviewLoading(true);
    setPreview(null);
    try {
      const res = await fetch("/api/onboarding/restore/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Backup-Filename": encodeURIComponent(file.name),
        },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al validar el archivo subido");
      setPreview(data);
      setConfirmOpen(true);
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : "Error al validar el archivo subido");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleConfirmRestore(confirmationPhrase: string) {
    if (!preview) return;
    setTriggering(true);
    setRestoreError("");
    try {
      const res = await fetch("/api/onboarding/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadToken: preview.uploadToken,
          sourceFilename: preview.sourceFilename,
          confirmationPhrase,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al iniciar la restauración");
      setConfirmOpen(false);
      setPreview(null);
      setRestoreLogId(data.id);
      setRestoreStatus(data.status);
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : "Error al iniciar la restauración");
    } finally {
      setTriggering(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError("");
    setErrors({});

    const parsed = onboardingSchema.safeParse({ name, email, password, businessName });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      parsed.error.issues.forEach((i) => {
        fieldErrors[i.path[0] as string] = i.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, businessName }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error al configurar el sistema");
      }

      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        router.push("/login?onboarded=1");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Error al configurar el sistema");
    } finally {
      setLoading(false);
    }
  }

  if (restoreLogId && restoreStatus) {
    return (
      <div className="space-y-6">
        <div className="flex justify-center">
          <Logo href="/" brand="WAB" size="lg" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Restaurando respaldo…</CardTitle>
            <p className="text-sm text-muted-darker mt-1">
              Esto puede tardar varios minutos. No cierres esta pestaña — te llevaremos al login en cuanto termine.
            </p>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <Logo href="/" brand="WAB" size="lg" />
      </div>

      {mode === "create" ? (
        <Card>
          <CardHeader>
            <CardTitle>Configuración inicial</CardTitle>
            <p className="text-sm text-muted-darker mt-1">
              Bienvenido. Crea la cuenta de administrador para empezar a usar el sistema.
            </p>
          </CardHeader>
          <CardBody>
            {serverError && (
              <Banner tone="danger" className="mb-4">
                {serverError}
              </Banner>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <FormField label="Nombre del negocio" required error={errors.businessName}>
                {(id) => (
                  <Input
                    id={id}
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="Mi Empresa"
                    autoComplete="organization"
                    error={errors.businessName}
                  />
                )}
              </FormField>

              <FormField label="Tu nombre" required error={errors.name}>
                {(id) => (
                  <Input
                    id={id}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Tu nombre completo"
                    autoComplete="name"
                    error={errors.name}
                  />
                )}
              </FormField>

              <FormField label="Email" required error={errors.email}>
                {(id) => (
                  <Input
                    id={id}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@email.com"
                    autoComplete="email"
                    error={errors.email}
                  />
                )}
              </FormField>

              <FormField label="Contraseña" required error={errors.password} hint="Mínimo 8 caracteres">
                {(id) => (
                  <>
                    <PasswordInput
                      id={id}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Crea una contraseña segura"
                      autoComplete="new-password"
                      error={errors.password}
                    />
                    <PasswordStrength password={password} />
                  </>
                )}
              </FormField>

              <Button type="submit" fullWidth loading={loading} icon={Rocket}>
                Crear cuenta y comenzar
              </Button>
            </form>
          </CardBody>
          <CardFooter>
            <button
              type="button"
              onClick={() => setMode("restore")}
              className="text-sm text-accent hover:underline"
            >
              ¿Ya tienes un respaldo? Restaurarlo en vez de crear una cuenta nueva
            </button>
          </CardFooter>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Restaurar respaldo</CardTitle>
            <p className="text-sm text-muted-darker mt-1">
              Sube un archivo <span className="font-mono">.tar</span> generado por este sistema (en esta u otra
              instancia) para migrar todos los datos aquí en vez de empezar de cero.
            </p>
          </CardHeader>
          <CardBody>
            {restoreError && (
              <Banner tone="danger" className="mb-4">
                {restoreError}
              </Banner>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".tar"
              className="hidden"
              onChange={handleFileSelected}
            />
            <Button
              type="button"
              fullWidth
              icon={Upload}
              loading={previewLoading}
              onClick={() => fileInputRef.current?.click()}
            >
              Subir archivo .tar
            </Button>
          </CardBody>
          <CardFooter>
            <button
              type="button"
              onClick={() => {
                setMode("create");
                setRestoreError("");
              }}
              className="flex items-center gap-1.5 text-sm text-accent hover:underline"
            >
              <ArrowLeft size={14} /> Volver a crear una cuenta nueva
            </button>
          </CardFooter>
        </Card>
      )}

      <RestoreConfirmModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        preview={preview}
        onConfirm={handleConfirmRestore}
        loading={triggering}
      />
    </div>
  );
}
