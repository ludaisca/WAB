"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Copy, Check, Trash2, RefreshCw, MessageCircle, FileText, Pencil, UserPlus, X } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Spinner } from "@/app/components/ui/spinner";
import { SkeletonDetail } from "@/app/components/ui/skeleton";
import { KpiStrip } from "@/app/components/ui/kpi-strip";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { Banner } from "@/app/components/ui/banner";
import { Switch } from "@/app/components/ui/switch";
import { useToast } from "@/app/components/ui/toast";

interface AccountDetail {
  id: string;
  userId: string;
  name: string;
  phoneNumber: string | null;
  phoneNumberId: string;
  wabaId: string | null;
  appId: string | null;
  status: string;
  errorMessage: string | null;
  lastActivity: string | null;
  autoAssignEnabled: boolean;
  hideUnattributedChats: boolean;
  qualityRating: string | null;
  messagingTier: string | null;
  qualityUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { chats: number; templates: number };
}

const STATUS_BADGE: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  CONNECTED:    { label: "Conectado",   tone: "success" },
  PENDING:      { label: "Pendiente",    tone: "warning" },
  ERROR:        { label: "Error",        tone: "danger" },
  DISCONNECTED: { label: "Desconectado", tone: "neutral" },
};

// Tono por valor crudo de Meta — cubre tanto ratings tipo "GREEN"/"YELLOW"/"RED"
// como nombres de evento tipo "FLAGGED"/"UNFLAGGED", según lo que reporte el
// webhook phone_number_quality_update.
function qualityTone(rating: string): "success" | "warning" | "danger" | "neutral" {
  const r = rating.toUpperCase();
  if (r.includes("RED") || (r.includes("FLAG") && !r.includes("UNFLAG"))) return "danger";
  if (r.includes("YELLOW") || r.includes("DOWNGRADE")) return "warning";
  if (r.includes("GREEN") || r.includes("UNFLAG") || r.includes("UPGRADE")) return "success";
  return "neutral";
}

const WEBHOOK_PATH = "/api/whatsapp/webhook";

interface UserOption {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  user: "Usuario",
  ejecutivo: "Ejecutivo",
};

export default function CuentaDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const { success, error: toastError } = useToast();
  const id = params.id as string;

  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingAppId, setEditingAppId] = useState(false);
  const [appIdDraft, setAppIdDraft] = useState("");
  const [savingAppId, setSavingAppId] = useState(false);

  const [sharedUsers, setSharedUsers] = useState<UserOption[]>([]);
  const [allUsers, setAllUsers] = useState<UserOption[]>([]);
  const [shareUserId, setShareUserId] = useState("");
  const [sharing, setSharing] = useState(false);

  const fetchAccount = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/accounts/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al cargar");
      setAccount(data);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al cargar cuenta");
    } finally {
      setLoading(false);
    }
  }, [id, toastError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    fetchAccount();
  }, [fetchAccount]);

  const fetchSharing = useCallback(async () => {
    try {
      const [sharedRes, usersRes] = await Promise.all([
        fetch(`/api/whatsapp/accounts/${id}/share`),
        fetch(`/api/usuarios`),
      ]);
      const sharedData = await sharedRes.json();
      const usersData = await usersRes.json();
      if (Array.isArray(sharedData)) setSharedUsers(sharedData);
      if (Array.isArray(usersData)) setAllUsers(usersData);
    } catch {
      // silencioso — la tarjeta de compartir es secundaria a la info principal de la cuenta
    }
  }, [id]);

  useEffect(() => {
    if (!isAdmin) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, gated by role
    fetchSharing();
  }, [isAdmin, fetchSharing]);

  async function handleShare() {
    if (!shareUserId) return;
    setSharing(true);
    try {
      const res = await fetch(`/api/whatsapp/accounts/${id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: shareUserId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al compartir");
      setShareUserId("");
      await fetchSharing();
      success("Cuenta compartida");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al compartir la cuenta");
    } finally {
      setSharing(false);
    }
  }

  async function handleUnshare(userId: string) {
    try {
      const res = await fetch(`/api/whatsapp/accounts/${id}/share?userId=${userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setSharedUsers((prev) => prev.filter((u) => u.id !== userId));
      success("Acceso removido");
    } catch {
      toastError("Error al quitar el acceso");
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/whatsapp/accounts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error al eliminar");
      success("Cuenta eliminada");
      router.push("/whatsapp/cuentas");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al eliminar");
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  function getWebhookUrl() {
    return typeof window !== "undefined"
      ? `${window.location.origin}${WEBHOOK_PATH}`
      : WEBHOOK_PATH;
  }

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function startEditAppId() {
    setAppIdDraft(account?.appId ?? "");
    setEditingAppId(true);
  }

  async function handleSaveAppId() {
    if (appIdDraft.trim() && !/^\d+$/.test(appIdDraft.trim())) {
      toastError("El App ID debe ser un ID numérico");
      return;
    }
    setSavingAppId(true);
    try {
      const res = await fetch(`/api/whatsapp/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: appIdDraft.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al guardar");
      setAccount((prev) => prev && { ...prev, appId: data.appId });
      setEditingAppId(false);
      success("App ID actualizado");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al guardar el App ID");
    } finally {
      setSavingAppId(false);
    }
  }

  async function handleToggleAutoAssign(enabled: boolean) {
    if (!account) return;
    setAccount({ ...account, autoAssignEnabled: enabled });
    try {
      const res = await fetch(`/api/whatsapp/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoAssignEnabled: enabled }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setAccount((prev) => prev && { ...prev, autoAssignEnabled: !enabled });
      toastError("Error al actualizar auto-asignación");
    }
  }

  async function handleToggleHideUnattributed(enabled: boolean) {
    if (!account) return;
    setAccount({ ...account, hideUnattributedChats: enabled });
    try {
      const res = await fetch(`/api/whatsapp/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hideUnattributedChats: enabled }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setAccount((prev) => prev && { ...prev, hideUnattributedChats: !enabled });
      toastError("Error al actualizar la visibilidad de chats");
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <SkeletonDetail cards={3} />
      </div>
    );
  }

  if (!account) {
    return (
      <div className="space-y-4">
        <Banner tone="danger" title="Cuenta no encontrada">
          La cuenta solicitada no existe o no tienes acceso.
        </Banner>
        <Button href="/whatsapp/cuentas" icon={ArrowLeft} variant="secondary">Volver</Button>
      </div>
    );
  }

  const badge = STATUS_BADGE[account.status] ?? { label: account.status, tone: "neutral" as const };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <Link href="/whatsapp/cuentas" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors mb-3">
          <ArrowLeft size={14} />
          Volver a cuentas
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{account.name}</h1>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>
      </div>

      {account.status === "ERROR" && account.errorMessage && (
        <Banner tone="danger" title="Error en la cuenta">
          {account.errorMessage}
        </Banner>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Información de la cuenta</CardTitle>
        </CardHeader>
        {/* Antes: 9 filas de tres asuntos distintos (identificadores técnicos,
            métricas y fechas) en una sola lista plana. Ahora van agrupadas, y las
            métricas —que son cifras— usan la franja KPI en vez de pares dt/dd. */}
        <CardBody className="space-y-6">
          <KpiStrip
            size="compact"
            items={[
              {
                label: "Chats activos",
                value: String(account._count.chats),
                numeric: account._count.chats,
              },
              {
                label: "Plantillas",
                value: String(account._count.templates),
                numeric: account._count.templates,
              },
            ]}
          />

          <InfoGroup title="Identificadores">
            <InfoRow label="Número" value={account.phoneNumber ?? "—"} mono />
            <InfoRow label="Phone Number ID" value={account.phoneNumberId} mono />
            <InfoRow label="WABA ID" value={account.wabaId ?? "—"} mono />
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="shrink-0 text-xs text-muted-darker">App ID</span>
              {editingAppId ? (
                <div className="flex flex-1 items-center justify-end gap-2">
                  <Input
                    value={appIdDraft}
                    onChange={(e) => setAppIdDraft(e.target.value)}
                    placeholder="123456789012345"
                    className="text-sm font-mono max-w-[200px]"
                  />
                  <Button size="sm" onClick={handleSaveAppId} disabled={savingAppId}>
                    {savingAppId ? <Spinner /> : "Guardar"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditingAppId(false)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <span className="flex items-center gap-2 font-mono text-xs text-foreground">
                  {account.appId ?? "—"}
                  {isAdmin && (
                  <button onClick={startEditAppId} className="text-muted-darker hover:text-foreground transition-colors" aria-label="Editar App ID">
                    <Pencil size={13} />
                  </button>
                  )}
                </span>
              )}
            </div>
          </InfoGroup>

          <InfoGroup title="Estado">
            {account.qualityRating && (
              <div className="flex items-center justify-between gap-4 py-2.5">
                <span className="shrink-0 text-xs text-muted-darker">Calidad del número</span>
                <span className="flex items-center gap-2">
                  <Badge tone={qualityTone(account.qualityRating)} size="sm">{account.qualityRating}</Badge>
                  {account.messagingTier && (
                    <span className="text-xs text-muted-darker">{account.messagingTier}</span>
                  )}
                </span>
              </div>
            )}
            <InfoRow
              label="Última actividad"
              mono
              value={
                account.lastActivity
                  ? new Date(account.lastActivity).toLocaleDateString("es-MX", {
                      day: "2-digit", month: "long", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })
                  : "—"
              }
            />
            <InfoRow
              label="Creada"
              mono
              value={new Date(account.createdAt).toLocaleDateString("es-MX", {
                day: "2-digit", month: "long", year: "numeric",
              })}
            />
          </InfoGroup>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuración del webhook</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-muted mb-3">
            Configura esta URL en tu App de Meta para recibir mensajes entrantes.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-surface px-3 py-2 rounded-lg text-xs font-mono break-all">
              {getWebhookUrl()}
            </code>
            <Button
              variant="secondary"
              size="sm"
              icon={copied ? Check : Copy}
              onClick={() => handleCopy(getWebhookUrl())}
            >
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
        </CardBody>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Asignación y visibilidad de chats</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm font-medium text-foreground">Auto-asignación de chats nuevos</p>
                <p className="text-xs text-muted-darker">
                  Reparte automáticamente los chats sin asignar entre los agentes con acceso a esta cuenta, según su carga actual.
                </p>
              </div>
              <Switch checked={account.autoAssignEnabled} onCheckedChange={handleToggleAutoAssign} />
            </div>

            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm font-medium text-foreground">Ocultar chats sin campaña</p>
                <p className="text-xs text-muted-darker">
                  Los roles Usuario y Ejecutivo solo verán los chats de esta cuenta que provengan de una campaña o de una automatización. Tú, como administrador, sigues viéndolos todos.
                </p>
              </div>
              <Switch checked={account.hideUnattributedChats} onCheckedChange={handleToggleHideUnattributed} />
            </div>
          </CardBody>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Compartir cuenta</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-muted mb-3">
              Los usuarios con acceso pueden ver los chats, contactos y campañas de esta cuenta — dentro de lo que su propio rol ya permite ver. Compartir no cambia sus permisos de menú.
            </p>

            {sharedUsers.length > 0 ? (
              <div className="flex flex-wrap gap-2 mb-4">
                {sharedUsers.map((u) => (
                  <Badge key={u.id} tone="neutral" size="sm" className="gap-1.5">
                    {u.name ?? u.email} · {ROLE_LABEL[u.role] ?? u.role}
                    <button
                      onClick={() => handleUnshare(u.id)}
                      className="hover:text-danger transition-colors"
                      aria-label={`Quitar acceso a ${u.name ?? u.email}`}
                    >
                      <X size={12} />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-darker mb-4">Todavía no compartes esta cuenta con nadie.</p>
            )}

            <div className="flex items-center gap-2">
              <Select value={shareUserId} onChange={(e) => setShareUserId(e.target.value)} className="flex-1">
                <option value="">Seleccionar usuario...</option>
                {allUsers
                  .filter((u) => u.id !== account.userId && !sharedUsers.some((s) => s.id === u.id))
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name ?? u.email} ({ROLE_LABEL[u.role] ?? u.role})
                    </option>
                  ))}
              </Select>
              <Button size="sm" icon={sharing ? undefined : UserPlus} onClick={handleShare} disabled={sharing || !shareUserId}>
                {sharing ? <Spinner /> : "Compartir"}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="flex gap-3 flex-wrap">
        <Button href={`/whatsapp/chat?accountId=${account.id}`} icon={MessageCircle}>Abrir chats</Button>
        <Button href={`/whatsapp/plantillas?accountId=${account.id}`} variant="secondary" icon={FileText}>Gestionar plantillas</Button>
        <Button variant="secondary" icon={RefreshCw} onClick={fetchAccount}>
          Actualizar
        </Button>
        {isAdmin && (
          <Button
            variant="danger"
            icon={Trash2}
            onClick={() => setDeleteOpen(true)}
          >
            Eliminar
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Eliminar cuenta"
        description={`¿Estás seguro de eliminar "${account.name}"? Esta acción eliminará permanentemente todos los chats y mensajes asociados. No se puede deshacer.`}
        confirmLabel={deleting ? "Eliminando..." : "Eliminar"}
        tone="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}

// Agrupa filas relacionadas bajo un eyebrow. Reemplaza al <dl> plano de 9 filas
// que mezclaba identificadores técnicos, métricas y fechas sin jerarquía.
function InfoGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-eyebrow font-medium uppercase tracking-eyebrow text-muted-darker">
        {title}
      </p>
      <dl className="divide-y divide-border">{children}</dl>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-xs text-muted-darker">{label}</dt>
      <dd
        className={`truncate text-right text-foreground ${
          mono ? "font-mono text-xs" : "text-sm font-medium"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
