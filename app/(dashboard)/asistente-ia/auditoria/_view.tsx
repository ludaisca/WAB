"use client";

import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/app/components/ui/page-header";
import { Table, type TableColumn } from "@/app/components/ui/table";
import { Badge } from "@/app/components/ui/badge";
import { Select } from "@/app/components/ui/select";
import { Pagination } from "@/app/components/ui/pagination";

interface ActionRow {
  id: string;
  toolName: string;
  riskTier: string;
  description: string;
  status: "PENDING" | "EXECUTED" | "REJECTED" | "EXPIRED" | "FAILED";
  errorMessage: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: { name: string | null; email: string } | null;
  conversation: { title: string | null };
}

const STATUS_TONE: Record<ActionRow["status"], "accent" | "success" | "neutral" | "warning" | "danger"> = {
  PENDING: "accent",
  EXECUTED: "success",
  REJECTED: "neutral",
  EXPIRED: "warning",
  FAILED: "danger",
};

const TIER_TONE: Record<string, "neutral" | "warning" | "danger"> = {
  READ: "neutral",
  MINOR: "warning",
  CONFIRM: "danger",
};

const PAGE_SIZE = 20;

export function AuditoriaView({ initialActions }: { initialActions: ActionRow[] }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    return initialActions.filter((a) => {
      if (statusFilter && a.status !== statusFilter) return false;
      if (tierFilter && a.riskTier !== tierFilter) return false;
      return true;
    });
  }, [initialActions, statusFilter, tierFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const columns: TableColumn<ActionRow>[] = [
    {
      key: "toolName",
      header: "Herramienta",
      render: (row) => (
        <div>
          <p className="font-mono text-xs">{row.toolName}</p>
          <p className="text-xs text-muted-darker truncate max-w-xs">{row.description}</p>
        </div>
      ),
    },
    {
      key: "riskTier",
      header: "Nivel",
      render: (row) => <Badge tone={TIER_TONE[row.riskTier] ?? "neutral"} size="sm">{row.riskTier}</Badge>,
    },
    {
      key: "status",
      header: "Estado",
      render: (row) => <Badge tone={STATUS_TONE[row.status]} size="sm">{row.status}</Badge>,
    },
    {
      key: "resolvedBy",
      header: "Resuelto por",
      hideBelow: "md",
      render: (row) => <span className="text-xs text-muted">{row.resolvedBy?.name || row.resolvedBy?.email || "—"}</span>,
    },
    {
      key: "createdAt",
      header: "Fecha",
      hideBelow: "sm",
      // timeZone explícito — sin esto, el servidor (UTC en Docker) y el navegador
      // del usuario (su zona local) formatean distinto y React tira un hydration
      // mismatch al montar este Client Component con el string ya renderizado en SSR.
      render: (row) => (
        <span className="font-mono text-xs text-muted">
          {new Date(row.createdAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mexico_City" })}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader title="Auditoría del Asistente IA" description="Historial de todas las acciones MINOR y CONFIRM ejecutadas, rechazadas o pendientes." />

      <div className="flex flex-wrap gap-3">
        <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="w-44" placeholder="Todos los estados">
          <option value="PENDING">Pendiente</option>
          <option value="EXECUTED">Ejecutada</option>
          <option value="REJECTED">Rechazada</option>
          <option value="EXPIRED">Expirada</option>
          <option value="FAILED">Falló</option>
        </Select>
        <Select value={tierFilter} onChange={(e) => { setTierFilter(e.target.value); setPage(1); }} className="w-44" placeholder="Todos los niveles">
          <option value="MINOR">MINOR</option>
          <option value="CONFIRM">CONFIRM</option>
        </Select>
      </div>

      <Table
        columns={columns}
        rows={pageRows}
        rowKey={(row) => row.id}
        emptyIcon={ShieldCheck}
        emptyTitle="Sin acciones registradas"
        emptyDescription="Las acciones del asistente (MINOR y CONFIRM) aparecerán aquí en cuanto se usen."
      />

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
