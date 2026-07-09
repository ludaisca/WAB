"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Send, Trash2, Users } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Spinner } from "@/app/components/ui/spinner";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { Banner } from "@/app/components/ui/banner";
import { Pagination } from "@/app/components/ui/pagination";
import { Table, type TableColumn } from "@/app/components/ui/table";
import { useToast } from "@/app/components/ui/toast";

const STATUS_BADGE: Record<string, { label: string; tone: "success" | "warning" | "info" | "danger" | "neutral" }> = {
  DRAFT: { label: "Borrador", tone: "neutral" },
  SCHEDULED: { label: "Programada", tone: "info" },
  SENDING: { label: "Enviando", tone: "warning" },
  COMPLETED: { label: "Completada", tone: "success" },
  FAILED: { label: "Fallida", tone: "danger" },
};

const RECIPIENT_BADGE: Record<string, { label: string; tone: "success" | "warning" | "info" | "danger" | "neutral" }> = {
  PENDING: { label: "Pendiente", tone: "neutral" },
  SENT: { label: "Enviado", tone: "info" },
  DELIVERED: { label: "Entregado", tone: "success" },
  READ: { label: "Leído", tone: "success" },
  FAILED: { label: "Fallido", tone: "danger" },
};

interface CampaignDetail {
  id: string;
  name: string;
  status: string;
  recipientCount: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  scheduledAt: string | null;
  sentAt: string | null;
  completedAt: string | null;
  createdAt: string;
  waAccount: { id: string; name: string; phoneNumber: string | null };
  waTemplate: { id: string; name: string };
}

interface Recipient {
  id: string;
  phoneNumber: string;
  contactName: string | null;
  status: string;
  errorMessage: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
}

export default function CampaignDetailPage() {
  const params = useParams();
  const { success, error: toastError } = useToast();
  const id = params.id as string;

  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const fetchCampaign = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/campaigns/${id}?page=${p}&limit=50`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const { recipients: recips, recipientsPagination, ...camp } = data;
      setCampaign(camp);
      setRecipients(recips || []);
      setTotalPages(recipientsPagination?.totalPages || 1);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [id, toastError]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount/page-change; fetchCampaign also used for manual refresh
  useEffect(() => { fetchCampaign(page); }, [fetchCampaign, page]);

  async function handleSend() {
    setSending(true);
    try {
      const res = await fetch(`/api/whatsapp/campaigns/${id}/send`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      success(`Campaña encolada para envío`);
      fetchCampaign(page);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error");
    } finally {
      setSending(false);
    }
  }

  const recipientColumns: TableColumn<Recipient>[] = useMemo(() => [
    { key: "phoneNumber", header: "Número", render: (r) => <span className="font-mono text-xs">{r.phoneNumber}</span> },
    { key: "contactName", header: "Nombre", render: (r) => <span className="text-xs">{r.contactName || "—"}</span>, hideBelow: "sm" },
    {
      key: "status",
      header: "Estado",
      render: (r) => {
        const rb = RECIPIENT_BADGE[r.status] ?? { label: r.status, tone: "neutral" as const };
        return <Badge tone={rb.tone} size="sm">{rb.label}</Badge>;
      },
    },
    {
      key: "errorMessage",
      header: "Error",
      render: (r) => <span className="text-xs text-danger max-w-[140px] truncate block">{r.errorMessage || "—"}</span>,
      hideBelow: "md",
    },
  ], []);

  if (loading) return <div className="flex items-center justify-center py-16"><Spinner /></div>;
  if (!campaign) return <Banner tone="danger" title="Campaña no encontrada">La campaña solicitada no existe.</Banner>;

  const statusBadge = STATUS_BADGE[campaign.status] ?? { label: campaign.status, tone: "neutral" as const };
  const progress = campaign.recipientCount > 0
    ? Math.round(((campaign.sentCount) / campaign.recipientCount) * 100) : 0;

  return (
    <div className="space-y-6 max-w-3xl">
      <Link href="/whatsapp/campanas" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors mb-3">
        <ArrowLeft size={14} /> Volver a campañas
      </Link>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{campaign.name}</h1>
          <p className="text-sm text-muted-darker mt-1">{campaign.waAccount.name} · {campaign.waTemplate.name}</p>
        </div>
        <div className="flex gap-2">
          {(campaign.status === "DRAFT" || campaign.status === "SCHEDULED") && (
            <Button icon={Send} size="sm" onClick={handleSend} disabled={sending}>
              {sending ? <Spinner /> : "Enviar ahora"}
            </Button>
          )}
          {campaign.status === "DRAFT" && (
            <Button variant="danger" size="sm" icon={Trash2} onClick={() => setDeleteOpen(true)} />
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(["recipientCount", "sentCount", "deliveredCount", "readCount"] as const).map(k => {
          const labels: Record<string, string> = {
            recipientCount: "Destinatarios",
            sentCount: "Enviados",
            deliveredCount: "Entregados",
            readCount: "Leídos",
          };
          return (
            <Card key={k}>
              <CardBody>
                <p className="text-xs text-muted-darker">{labels[k]}</p>
                <p className="text-2xl font-bold mt-1">{campaign[k]}</p>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {campaign.status !== "DRAFT" && (
        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-surface rounded-full h-2 overflow-hidden">
                <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-sm font-medium">{progress}%</span>
              <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Destinatarios ({campaign.recipientCount})</CardTitle>
        </CardHeader>
        <CardBody>
          <Table
            columns={recipientColumns}
            rows={recipients}
            rowKey={(r) => r.id}
            emptyIcon={Users}
            emptyTitle="Sin destinatarios"
          />
          {totalPages > 1 && (
            <div className="flex justify-center mt-4 pt-4 border-t border-border">
              <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Eliminar campaña"
        description="Solo se pueden eliminar campañas en borrador."
        confirmLabel="Eliminar"
        tone="danger"
        onConfirm={async () => {
          await fetch(`/api/whatsapp/campaigns/${id}`, { method: "DELETE" });
          success("Campaña eliminada");
          setDeleteOpen(false);
        }}
      />
    </div>
  );
}
