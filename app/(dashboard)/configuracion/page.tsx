"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { User, Lock, Shield, CalendarDays, Brain, Users, FileSpreadsheet, ExternalLink, RefreshCw, Unlink, DatabaseBackup } from "lucide-react";
import { Card, CardTitle, CardBody } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { PasswordInput } from "@/app/components/ui/password-input";
import { PasswordStrength } from "@/app/components/ui/password-strength";
import { FormField } from "@/app/components/ui/form-field";
import { Banner } from "@/app/components/ui/banner";
import { Badge } from "@/app/components/ui/badge";
import { Switch } from "@/app/components/ui/switch";
import { PageHeader } from "@/app/components/ui/page-header";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { useToast } from "@/app/components/ui/toast";
import { RespuestasRapidasSection } from "./_respuestas-rapidas";

interface GoogleSheetsStatus {
  connected: boolean;
  googleEmail?: string;
  spreadsheetId?: string;
  lastSyncedAt?: string | null;
  lastSyncError?: string | null;
  enabled?: boolean;
}

export default function SettingsPage() {
  const { data: session, update } = useSession();
  const { success, error: toastError } = useToast();

  const user = session?.user;
  const name = user?.name ?? "Usuario";
  const email = user?.email ?? "";
  const initials = name.slice(0, 2).toUpperCase();

  const [newName, setNewName] = useState(name);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [saving, setSaving] = useState(false);

  const [savingName, setSavingName] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [twoFactor, setTwoFactor] = useState(false);
  const [allowRegistration, setAllowRegistration] = useState(true);
  const [systemLoading, setSystemLoading] = useState(false);

  const isAdmin = session?.user?.role === "admin";

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/configuracion/sistema")
      .then((r) => r.json())
      .then((d) => {
        if (d.allowRegistration !== undefined) {
          setAllowRegistration(d.allowRegistration);
        }
      })
      .catch(() => toastError("Error al cargar configuración"));
  }, [isAdmin, toastError]);

  const [googleStatus, setGoogleStatus] = useState<GoogleSheetsStatus>({ connected: false });
  const [loadingGoogleStatus, setLoadingGoogleStatus] = useState(true);
  const [syncingNow, setSyncingNow] = useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const fetchGoogleStatus = useCallback(() => {
    setLoadingGoogleStatus(true);
    fetch("/api/integrations/google-sheets/status")
      .then((r) => r.json())
      .then((d) => setGoogleStatus(d))
      .catch(() => toastError("Error al cargar el estado de Google Sheets"))
      .finally(() => setLoadingGoogleStatus(false));
  }, [toastError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; fetchGoogleStatus también se usa para refrescar manualmente
    fetchGoogleStatus();
    // Lectura directa de window.location en vez de useSearchParams para no
    // tener que envolver esta página en Suspense (regla del proyecto para
    // páginas que sí usan ese hook) — aquí solo necesitamos leerlo una vez
    // al montar, tras volver del flujo OAuth.
    const params = new URLSearchParams(window.location.search);
    if (params.get("google_connected") === "1") {
      success("Cuenta de Google conectada correctamente");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("google_error")) {
      const reason = params.get("google_error");
      toastError(
        reason === "denied"
          ? "Cancelaste la conexión con Google"
          : "No se pudo conectar con Google, intenta de nuevo"
      );
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar, para leer el retorno del OAuth una sola vez
  }, []);

  async function handleSyncNow() {
    setSyncingNow(true);
    try {
      const res = await fetch("/api/integrations/google-sheets/sync-now", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al sincronizar");
      success("Sincronización completada");
      fetchGoogleStatus();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al sincronizar");
    } finally {
      setSyncingNow(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/integrations/google-sheets/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("Error al desconectar");
      success("Cuenta de Google desconectada");
      setDisconnectConfirmOpen(false);
      fetchGoogleStatus();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al desconectar");
    } finally {
      setDisconnecting(false);
    }
  }

  const createdAt = (session?.user as { createdAt?: string })?.createdAt;

  async function handleSaveName() {
    if (!newName.trim()) return;
    setSavingName(true);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Error al guardar");
      }
      await update();
      success("Nombre actualizado");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error");
    } finally {
      setSavingName(false);
    }
  }

  async function handleSavePassword() {
    setPasswordError("");

    if (!currentPassword) {
      setPasswordError("Ingresa tu contraseña actual");
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      setPasswordError("La nueva contraseña debe tener al menos 8 caracteres");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Las contraseñas no coinciden");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Error al cambiar contraseña");
      }

      success("Contraseña actualizada correctamente");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al cambiar contraseña");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <PageHeader title="Configuración" description="Administra tu cuenta y preferencias." />

      <Card>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-on-accent font-bold text-xl shrink-0 select-none">
            {initials}
          </div>
          <div>
            <h2 className="text-lg font-semibold">{name}</h2>
            <p className="text-sm text-muted-darker">{email}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <Badge tone="info" size="sm">{user?.role === "user" ? "Usuario" : user?.role}</Badge>
              <span className="text-xs text-muted-darker flex items-center gap-1">
                <CalendarDays size={11} />
                Miembro desde {createdAt ? new Date(createdAt).toLocaleDateString("es-MX", { year: "numeric", month: "long" }) : new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long" })}
              </span>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardBody>
          <div className="flex items-center gap-2 mb-6">
            <User size={16} className="text-accent" />
            <CardTitle>Cuenta</CardTitle>
          </div>

          <div className="space-y-4">
            <FormField label="Nombre">
              {(id) => (
                <Input
                  id={id}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              )}
            </FormField>

            <Button size="sm" icon={User} onClick={handleSaveName} loading={savingName}>Guardar nombre</Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="flex items-center gap-2 mb-6">
            <Lock size={16} className="text-accent" />
            <CardTitle>Cambiar contraseña</CardTitle>
          </div>

          {passwordError && (
            <Banner tone="danger" className="mb-4">{passwordError}</Banner>
          )}

          <div className="space-y-4">
            <FormField label="Contraseña actual" required>
              {(id) => (
                <PasswordInput
                  id={id}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              )}
            </FormField>

            <FormField label="Nueva contraseña" required>
              {(id) => (
                <>
                  <PasswordInput
                    id={id}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    autoComplete="new-password"
                  />
                  <PasswordStrength password={newPassword} />
                </>
              )}
            </FormField>

            <FormField label="Confirmar nueva contraseña" required>
              {(id) => (
                <PasswordInput
                  id={id}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repite la contraseña"
                  autoComplete="new-password"
                />
              )}
            </FormField>

            <Button size="sm" icon={Lock} onClick={handleSavePassword} loading={saving}>
              Cambiar contraseña
            </Button>
          </div>
        </CardBody>
      </Card>

      {isAdmin && (
        <Card>
          <CardBody>
            <div className="flex items-center gap-2 mb-4">
              <Brain size={16} className="text-accent" />
              <CardTitle>Inteligencia Artificial</CardTitle>
            </div>
            <p className="text-sm text-muted-darker mb-4">
              Configura las API keys de OpenRouter y Google Gemini para usar los bots IA, RAG y embeddings.
            </p>
            <Button href="/configuracion/ia" variant="secondary" size="sm" icon={Brain}>
              Configurar IA
            </Button>
          </CardBody>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardBody>
            <div className="flex items-center gap-2 mb-4">
              <DatabaseBackup size={16} className="text-accent" />
              <CardTitle>Backups y restauración</CardTitle>
            </div>
            <p className="text-sm text-muted-darker mb-4">
              Respalda toda la información del sistema (base de datos + medios) o restaura un respaldo para migrar
              entre servidores.
            </p>
            <Button href="/configuracion/backups" variant="secondary" size="sm" icon={DatabaseBackup}>
              Administrar backups
            </Button>
          </CardBody>
        </Card>
      )}

      <RespuestasRapidasSection />

      {isAdmin && (
        <Card>
          <CardBody>
            <div className="flex items-center gap-2 mb-4">
              <Users size={16} className="text-accent" />
              <CardTitle>Sistema</CardTitle>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm font-medium text-foreground">Registro libre</p>
                  <p className="text-xs text-muted-darker">Permitir que cualquier persona se registre desde /register</p>
                </div>
                <Switch
                  checked={allowRegistration}
                  disabled={systemLoading}
                  onCheckedChange={async (v) => {
                    setAllowRegistration(v);
                    setSystemLoading(true);
                    try {
                      const res = await fetch("/api/configuracion/sistema", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ allowRegistration: v }),
                      });
                      if (!res.ok) {
                        setAllowRegistration(!v);
                        toastError("Error al actualizar");
                      } else {
                        success(v ? "Registro libre activado" : "Registro libre desactivado");
                      }
                    } catch {
                      setAllowRegistration(!v);
                      toastError("Error al actualizar");
                    } finally {
                      setSystemLoading(false);
                    }
                  }}
                />
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          <div className="flex items-center gap-2 mb-4">
            <FileSpreadsheet size={16} className="text-accent" />
            <CardTitle>Google Sheets</CardTitle>
          </div>
          <p className="text-sm text-muted-darker mb-4">
            Sincroniza automáticamente los reportes que configures a tus hojas de Google, cada 15 minutos.
          </p>

          {!loadingGoogleStatus && !googleStatus.connected && (
            <Button
              size="sm"
              icon={FileSpreadsheet}
              onClick={() => { window.location.href = "/api/integrations/google-sheets/connect"; }}
            >
              Conectar con Google
            </Button>
          )}

          {!loadingGoogleStatus && googleStatus.connected && (
            <div className="space-y-3">
              {googleStatus.lastSyncError && (
                <Banner tone="danger">{googleStatus.lastSyncError}</Banner>
              )}
              <p className="text-sm text-foreground">
                Conectado como <span className="font-medium">{googleStatus.googleEmail}</span>
              </p>
              <p className="text-xs text-muted-darker">
                Última sincronización:{" "}
                {googleStatus.lastSyncedAt
                  ? new Date(googleStatus.lastSyncedAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })
                  : "Nunca"}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" icon={FileSpreadsheet} href="/configuracion/exportaciones">
                  Administrar exportaciones
                </Button>
                {googleStatus.spreadsheetId && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={ExternalLink}
                    href={`https://docs.google.com/spreadsheets/d/${googleStatus.spreadsheetId}`}
                    external
                  >
                    Abrir hoja
                  </Button>
                )}
                <Button size="sm" variant="secondary" icon={RefreshCw} onClick={handleSyncNow} loading={syncingNow}>
                  Sincronizar ahora
                </Button>
                <Button size="sm" variant="danger" icon={Unlink} onClick={() => setDisconnectConfirmOpen(true)}>
                  Desconectar
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={disconnectConfirmOpen}
        onClose={() => setDisconnectConfirmOpen(false)}
        onConfirm={handleDisconnect}
        title="¿Desconectar Google Sheets?"
        description="Se detendrá la sincronización automática. Podrás volver a conectar tu cuenta cuando quieras."
        confirmLabel="Desconectar"
        tone="danger"
        loading={disconnecting}
      />

      <Card>
        <CardBody>
          <div className="flex items-center gap-2 mb-6">
            <Shield size={16} className="text-accent" />
            <CardTitle>Preferencias</CardTitle>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm font-medium text-foreground">Notificaciones por email</p>
                <p className="text-xs text-muted-darker">Recibir actualizaciones y alertas por correo</p>
              </div>
              <Switch checked={notifications} onCheckedChange={setNotifications} />
            </div>

            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm font-medium text-foreground">Autenticación en dos pasos</p>
                <p className="text-xs text-muted-darker">Agrega una capa extra de seguridad</p>
              </div>
              <Switch checked={twoFactor} onCheckedChange={setTwoFactor} />
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
