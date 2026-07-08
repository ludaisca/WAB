"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, Megaphone, Trash2, Eye } from "lucide-react";
import { Card, CardBody } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Spinner } from "@/app/components/ui/spinner";
import { EmptyState } from "@/app/components/ui/empty-state";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { useToast } from "@/app/components/ui/toast";

interface Campaign {
  id: string;
  name: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  completedAt: string | null;
  recipientCount: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  createdAt: string;
  waAccount: { id: string; name: string; phoneNumber: string | null };
  waTemplate: { id: string; name: string };
}

const STATUS_BADGE: Record<string, { label: string; tone: "success" | "warning" | "info" | "danger" | "neutral" }> = {
  DRAFT:     { label: "Borrador",   tone: "neutral" },
  SCHEDULED: { label: "Programada", tone: "info" },
  SENDING:   { label: "Enviando",   tone: "warning" },
  COMPLETED: { label: "Completada", tone: "success" },
  FAILED:    { label: "Fallida",    tone: "danger" },
};

export default function CampaignsPage() {
  const { success, error: toastError } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/campaigns");
      const data = await res.json();
      if (Array.isArray(data)) setCampaigns(data);
    } catch {
      toastError("Error al cargar campañas");
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; fetchCampaigns also used for manual refresh
  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/whatsapp/campaigns/${deleteId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Error al eliminar");
      }
      success("Campaña eliminada");
      setCampaigns((prev) => prev.filter((c) => c.id !== deleteId));
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error");
    } finally {
      setDeleteId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campañas</h1>
          <p className="mt-1 text-sm text-muted">Envía mensajes masivos usando plantillas de WhatsApp.</p>
        </div>
        <Link href="/whatsapp/campanas/nueva">
          <Button icon={Plus} size="sm">Nueva campaña</Button>
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Spinner /></div>
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="Sin campañas"
          description="Crea tu primera campaña de WhatsApp para enviar mensajes a múltiples destinatarios."
        />
      ) : (
        <div className="space-y-4">
          {campaigns.map((c) => {
            const badge = STATUS_BADGE[c.status] ?? { label: c.status, tone: "neutral" as const };
            const progress = c.recipientCount > 0
              ? Math.round(((c.sentCount + (c.deliveredCount || 0)) / c.recipientCount) * 100)
              : 0;
            return (
              <Card key={c.id}>
                <CardBody>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Link href={`/whatsapp/campanas/${c.id}`} className="font-semibold text-sm text-accent hover:underline truncate">
                          {c.name}
                        </Link>
                        <Badge tone={badge.tone} size="sm">{badge.label}</Badge>
                      </div>
                      <p className="text-xs text-muted-darker mt-1">
                        {c.waAccount.name} · Plantilla: {c.waTemplate.name}
                      </p>
                      {c.status !== "DRAFT" && (
                        <div className="mt-3 space-y-1.5">
                          <div className="flex items-center gap-2 text-xs text-muted-darker">
                            <div className="flex-1 bg-surface rounded-full h-1.5 overflow-hidden">
                              <div
                                className="h-full bg-accent rounded-full transition-all"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <span>{progress}%</span>
                          </div>
                          <div className="flex gap-3 text-xs text-muted-darker">
                            <span>Env: {c.sentCount}</span>
                            <span>Entr: {c.deliveredCount}</span>
                            <span>Leídos: {c.readCount}</span>
                            {c.failedCount > 0 && <span className="text-danger">Fallos: {c.failedCount}</span>}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Link href={`/whatsapp/campanas/${c.id}`}>
                        <Button variant="secondary" size="sm" icon={Eye}>Detalle</Button>
                      </Link>
                      {c.status === "DRAFT" && (
                        <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setDeleteId(c.id)} className="text-muted-darker hover:text-danger" />
                      )}
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Eliminar campaña"
        description="Solo se pueden eliminar campañas en borrador."
        confirmLabel="Eliminar"
        tone="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
