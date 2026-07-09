"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Search, Plus, RefreshCw, Phone, MoreVertical, Trash2, Settings2 } from "lucide-react";
import { Card } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { Spinner } from "@/app/components/ui/spinner";
import { Dropdown, DropdownItem } from "@/app/components/ui/dropdown";
import { useToast } from "@/app/components/ui/toast";

interface WaAccount {
  id: string;
  name: string;
  channel: string;
  phoneNumber: string | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  status: string;
  errorMessage: string | null;
  lastActivity: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { chats: number };
}

const STATUS_BADGE: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  CONNECTED:    { label: "Conectado",   tone: "success" },
  PENDING:      { label: "Pendiente",    tone: "warning" },
  ERROR:        { label: "Error",        tone: "danger" },
  DISCONNECTED: { label: "Desconectado", tone: "neutral" },
};

export default function CuentasPage() {
  const { success, error: toastError } = useToast();
  const [accounts, setAccounts] = useState<WaAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/accounts");
      const data = await res.json();
      if (Array.isArray(data)) setAccounts(data);
    } catch {
      toastError("Error al cargar cuentas");
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; fetchAccounts also used for manual refresh
    fetchAccounts();
  }, [fetchAccounts]);

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/whatsapp/accounts/${deleteId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Error al eliminar");
      }
      success("Cuenta eliminada correctamente");
      setAccounts((prev) => prev.filter((a) => a.id !== deleteId));
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al eliminar");
    } finally {
      setDeleteId(null);
    }
  }

  const filtered = accounts.filter((a) => {
    if (search && !a.name.toLowerCase().includes(search.toLowerCase()) && a.phoneNumber?.toLowerCase().includes(search.toLowerCase()) === false) return false;
    if (statusFilter && a.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cuentas WhatsApp</h1>
          <p className="mt-1 text-sm text-muted">
            Administra los números de WhatsApp Business conectados.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={fetchAccounts}>
            Actualizar
          </Button>
          <Link href="/whatsapp/cuentas/nueva">
            <Button icon={Plus} size="sm">Agregar número</Button>
          </Link>
        </div>
      </div>

      <Card>
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <Input
            icon={Search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o número..."
            className="sm:max-w-xs flex-1"
          />
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            placeholder="Todos los estados"
            className="sm:max-w-[180px]"
          >
            <option value="">Todos los estados</option>
            <option value="CONNECTED">Conectado</option>
            <option value="PENDING">Pendiente</option>
            <option value="ERROR">Error</option>
            <option value="DISCONNECTED">Desconectado</option>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Phone}
            title={accounts.length === 0 ? "Sin cuentas" : "Sin resultados"}
            description={
              accounts.length === 0
                ? "No has agregado ninguna cuenta de WhatsApp. Conecta tu primer número para empezar."
                : "No se encontraron cuentas con los filtros actuales."
            }
          />
        ) : (
          <>
            <div className="hidden sm:block overflow-x-auto -mx-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border">
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-darker uppercase tracking-wider">Nombre</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-darker uppercase tracking-wider">Número</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-darker uppercase tracking-wider">Estado</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-darker uppercase tracking-wider">Chats</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-darker uppercase tracking-wider">Última actividad</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-darker uppercase tracking-wider w-12" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((account) => {
                    const badge = STATUS_BADGE[account.status] ?? { label: account.status, tone: "neutral" as const };
                    return (
                      <tr key={account.id} className="hover:bg-surface-light/40 transition-colors">
                        <td className="px-5 py-3">
                          <Link href={`/whatsapp/cuentas/${account.id}`} className="font-medium text-accent hover:underline">
                            {account.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {account.phoneNumber ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge tone={badge.tone} size="sm">{badge.label}</Badge>
                            {account.channel === "BAILEYS" && (
                              <Badge tone="warning" size="sm">WhatsApp Web</Badge>
                            )}
                          </div>
                          {account.status === "ERROR" && account.errorMessage && (
                            <p className="text-xs text-danger mt-1 max-w-[160px] truncate" title={account.errorMessage}>
                              {account.errorMessage}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">{account._count.chats}</td>
                        <td className="px-4 py-3 text-xs text-muted-darker">
                          {account.lastActivity
                            ? new Date(account.lastActivity).toLocaleDateString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Dropdown
                            trigger={
                              <button className="p-1 rounded-md hover:bg-surface-light text-muted-darker hover:text-foreground transition-colors">
                                <MoreVertical size={14} />
                              </button>
                            }
                          >
                            <DropdownItem onClick={() => window.location.href = `/whatsapp/cuentas/${account.id}`}>
                              <Settings2 size={14} />
                              Detalles
                            </DropdownItem>
                            <DropdownItem onClick={() => setDeleteId(account.id)}>
                              <Trash2 size={14} />
                              Eliminar
                            </DropdownItem>
                          </Dropdown>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="sm:hidden divide-y divide-border -mx-5">
              {filtered.map((account) => {
                const badge = STATUS_BADGE[account.status] ?? { label: account.status, tone: "neutral" as const };
                return (
                  <div key={account.id} className="px-5 py-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <Link href={`/whatsapp/cuentas/${account.id}`} className="font-medium text-sm text-accent hover:underline">
                        {account.name}
                      </Link>
                      <Badge tone={badge.tone} size="sm">{badge.label}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-darker">
                      <span className="font-mono">{account.phoneNumber ?? "—"}</span>
                      <span>{account._count.chats} chats</span>
                      {account.lastActivity && (
                        <span className="ml-auto">
                          {new Date(account.lastActivity).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Eliminar cuenta"
        description="Esta acción eliminará permanentemente la cuenta y todos sus chats y mensajes asociados. No se puede deshacer."
        confirmLabel="Eliminar"
        tone="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
