"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Copy, Check, Trash2, RefreshCw, MessageCircle, FileText } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Spinner } from "@/app/components/ui/spinner";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { Banner } from "@/app/components/ui/banner";
import { useToast } from "@/app/components/ui/toast";

interface AccountDetail {
  id: string;
  name: string;
  phoneNumber: string | null;
  phoneNumberId: string;
  wabaId: string | null;
  status: string;
  errorMessage: string | null;
  lastActivity: string | null;
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

const WEBHOOK_PATH = "/api/whatsapp/webhook";

export default function CuentaDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const id = params.id as string;

  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (!account) {
    return (
      <div className="space-y-4">
        <Banner tone="danger" title="Cuenta no encontrada">
          La cuenta solicitada no existe o no tienes acceso.
        </Banner>
        <Link href="/whatsapp/cuentas">
          <Button icon={ArrowLeft} variant="secondary">Volver</Button>
        </Link>
      </div>
    );
  }

  const badge = STATUS_BADGE[account.status] ?? { label: account.status, tone: "neutral" as const };

  return (
    <div className="space-y-6 max-w-2xl">
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
        <CardBody>
          <dl className="space-y-4">
            <div className="flex justify-between border-b border-border pb-3">
              <dt className="text-sm text-muted-darker">Número</dt>
              <dd className="text-sm font-mono">{account.phoneNumber ?? "—"}</dd>
            </div>
            <div className="flex justify-between border-b border-border pb-3">
              <dt className="text-sm text-muted-darker">Phone Number ID</dt>
              <dd className="text-sm font-mono">{account.phoneNumberId}</dd>
            </div>
            <div className="flex justify-between border-b border-border pb-3">
              <dt className="text-sm text-muted-darker">WABA ID</dt>
              <dd className="text-sm font-mono">{account.wabaId ?? "—"}</dd>
            </div>
            <div className="flex justify-between border-b border-border pb-3">
              <dt className="text-sm text-muted-darker">Chats activos</dt>
              <dd className="text-sm font-medium">{account._count.chats}</dd>
            </div>
            <div className="flex justify-between border-b border-border pb-3">
              <dt className="text-sm text-muted-darker">Plantillas</dt>
              <dd className="text-sm font-medium">{account._count.templates}</dd>
            </div>
            <div className="flex justify-between border-b border-border pb-3">
              <dt className="text-sm text-muted-darker">Última actividad</dt>
              <dd className="text-sm">
                {account.lastActivity
                  ? new Date(account.lastActivity).toLocaleDateString("es-MX", {
                      day: "2-digit", month: "long", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })
                  : "—"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-muted-darker">Creada</dt>
              <dd className="text-sm">
                {new Date(account.createdAt).toLocaleDateString("es-MX", {
                  day: "2-digit", month: "long", year: "numeric",
                })}
              </dd>
            </div>
          </dl>
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

      <div className="flex gap-3 flex-wrap">
        <Link href={`/whatsapp/chat?accountId=${account.id}`}>
          <Button icon={MessageCircle}>Abrir chats</Button>
        </Link>
        <Link href={`/whatsapp/plantillas?accountId=${account.id}`}>
          <Button variant="secondary" icon={FileText}>Gestionar plantillas</Button>
        </Link>
        <Link href={`/whatsapp/cuentas/${account.id}`}>
          <Button variant="secondary" icon={RefreshCw} onClick={fetchAccount}>
            Actualizar
          </Button>
        </Link>
        <Button
          variant="danger"
          icon={Trash2}
          onClick={() => setDeleteOpen(true)}
        >
          Eliminar
        </Button>
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
