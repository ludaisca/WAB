"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Search, Plus, RefreshCw, Phone, Trash2, Settings2 } from "lucide-react";
import { Card } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { DropdownItem } from "@/app/components/ui/dropdown";
import { PageHeader } from "@/app/components/ui/page-header";
import { Table, type TableColumn } from "@/app/components/ui/table";
import { useToast } from "@/app/components/ui/toast";
import { CuentaFormModal } from "./_form";

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
  return (
    <Suspense fallback={null}>
      <CuentasView />
    </Suspense>
  );
}

function CuentasView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  // Alta/baja de números es admin-only en la API; ocultarlo aquí evita ofrecer
  // acciones que van a devolver 403.
  const isAdmin = session?.user?.role === "admin";
  const { success, error: toastError } = useToast();
  const [accounts, setAccounts] = useState<WaAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(searchParams.get("nueva") === "1");

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/whatsapp/accounts");
      const data = await res.json();
      if (Array.isArray(data)) setAccounts(data);
      else throw new Error(data.error ?? "Error al cargar cuentas");
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Error al cargar cuentas");
    } finally {
      setLoading(false);
    }
  }, []);

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

  const filtered = useMemo(() => accounts.filter((a) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || a.name.toLowerCase().includes(q) || (a.phoneNumber?.toLowerCase().includes(q) ?? false);
    if (!matchesSearch) return false;
    if (statusFilter && a.status !== statusFilter) return false;
    return true;
  }), [accounts, search, statusFilter]);

  const columns: TableColumn<WaAccount>[] = useMemo(() => [
    {
      key: "name",
      header: "Nombre",
      render: (a) => (
        <Link href={`/whatsapp/cuentas/${a.id}`} className="font-medium text-accent hover:underline">
          {a.name}
        </Link>
      ),
    },
    {
      key: "phoneNumber",
      header: "Número",
      render: (a) => <span className="font-mono text-xs">{a.phoneNumber ?? "—"}</span>,
      hideBelow: "sm",
    },
    {
      key: "status",
      header: "Estado",
      render: (a) => {
        const badge = STATUS_BADGE[a.status] ?? { label: a.status, tone: "neutral" as const };
        return (
          <div>
            <div className="flex flex-wrap items-center gap-1">
              <Badge tone={badge.tone} size="sm">{badge.label}</Badge>
            </div>
            {a.status === "ERROR" && a.errorMessage && (
              <p className="text-xs text-danger mt-1 max-w-[160px] truncate" title={a.errorMessage}>
                {a.errorMessage}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: "chats",
      header: "Chats",
      render: (a) => <span className="text-sm">{a._count.chats}</span>,
      hideBelow: "md",
    },
    {
      key: "lastActivity",
      header: "Última actividad",
      render: (a) => (
        <span className="text-xs text-muted-darker">
          {a.lastActivity
            ? new Date(a.lastActivity).toLocaleDateString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
            : "—"}
        </span>
      ),
      hideBelow: "md",
    },
  ], []);

  return (
    <div className="space-y-6 animate-fade-in-up">
      <PageHeader
        title="Cuentas WhatsApp"
        description="Administra los números de WhatsApp Business conectados."
        actions={
          <>
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={fetchAccounts}>
              Actualizar
            </Button>
            {isAdmin && (
              <Button icon={Plus} size="sm" onClick={() => setFormOpen(true)}>Agregar número</Button>
            )}
          </>
        }
      />

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

        <Table
          columns={columns}
          rows={filtered}
          rowKey={(a) => a.id}
          loading={loading}
          error={fetchError}
          onRetry={fetchAccounts}
          emptyIcon={Phone}
          emptyTitle={accounts.length === 0 ? "Sin cuentas" : "Sin resultados"}
          emptyDescription={
            accounts.length === 0
              ? "No has agregado ninguna cuenta de WhatsApp. Conecta tu primer número para empezar."
              : "No se encontraron cuentas con los filtros actuales."
          }
          rowActions={(a) => (
            <>
              <DropdownItem icon={Settings2} onClick={() => router.push(`/whatsapp/cuentas/${a.id}`)}>
                Detalles
              </DropdownItem>
              {isAdmin && (
                <DropdownItem icon={Trash2} onClick={() => setDeleteId(a.id)}>
                  Eliminar
                </DropdownItem>
              )}
            </>
          )}
          mobileCard={(a) => {
            const badge = STATUS_BADGE[a.status] ?? { label: a.status, tone: "neutral" as const };
            return (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Link href={`/whatsapp/cuentas/${a.id}`} className="font-medium text-sm text-accent hover:underline">
                    {a.name}
                  </Link>
                  <Badge tone={badge.tone} size="sm">{badge.label}</Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-darker">
                  <span className="font-mono">{a.phoneNumber ?? "—"}</span>
                  <span>{a._count.chats} chats</span>
                  {a.lastActivity && (
                    <span className="ml-auto">
                      {new Date(a.lastActivity).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
                    </span>
                  )}
                </div>
              </div>
            );
          }}
        />
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

      <CuentaFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          if (searchParams.get("nueva")) router.replace("/whatsapp/cuentas");
        }}
        onCreated={fetchAccounts}
      />
    </div>
  );
}
