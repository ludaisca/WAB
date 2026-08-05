"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Search, Shield, ShieldOff, Trash2, UserPlus, Users } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Spinner } from "@/app/components/ui/spinner";
import { PageHeader } from "@/app/components/ui/page-header";
import { EntityList, EntityRow } from "@/app/components/ui/entity-list";
import { EntityAvatar } from "@/app/components/ui/avatar";
import { DropdownItem } from "@/app/components/ui/dropdown";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { useToast } from "@/app/components/ui/toast";
import { UserFormModal } from "./_form";
import { formatDate } from "@/lib/timezone";
import type { AgentPerformanceRow } from "@/lib/estadisticas/agent-performance";

interface UserData {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: string;
  waAccounts: Array<{ id: string; name: string }>;
}

export default function UsersPage() {
  const { success, error: toastError } = useToast();
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [performance, setPerformance] = useState<AgentPerformanceRow[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<UserData | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/usuarios");
      const data = await res.json();
      if (Array.isArray(data)) setUsers(data);
      else throw new Error(data.error ?? "Error al cargar usuarios");
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Error al cargar usuarios");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; fetchUsers also used for manual refresh
  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  useEffect(() => {
    // El desempeño es un extra (columna de contexto) — un fallo aquí no debe
    // tumbar la lista de usuarios, así que solo se loguea, sin toast.
    fetch("/api/usuarios/performance")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setPerformance(d); })
      .catch(() => {});
  }, []);

  const performanceByUserId = useMemo(
    () => new Map(performance.map((p) => [p.userId, p])),
    [performance]
  );

  const filtered = useMemo(() => users.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (u.name?.toLowerCase().includes(q) ?? false) || u.email.toLowerCase().includes(q);
  }), [users, search]);

  const toggleRole = useCallback(async (userId: string, currentRole: string) => {
    setTogglingId(userId);
    const cycle: Record<string, string> = { user: "ejecutivo", ejecutivo: "admin", admin: "user" };
    const newRole = cycle[currentRole] ?? "user";
    try {
      const res = await fetch("/api/usuarios", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const labels: Record<string, string> = { admin: "Admin", user: "Usuario", ejecutivo: "Ejecutivo" };
      success(`Rol actualizado a ${labels[newRole]}`);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      );
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error");
    } finally {
      setTogglingId(null);
    }
  }, [success, toastError]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/usuarios/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Error al eliminar");
      success("Usuario eliminado");
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al eliminar");
    } finally {
      setDeleting(false);
    }
  }

  function nextRoleLabel(role: string): string {
    const labels: Record<string, string> = { user: "Ejecutivo", ejecutivo: "Admin", admin: "Usuario" };
    return labels[role] ?? "Usuario";
  }

  function nextRoleIcon(role: string) {
    return role === "admin" ? ShieldOff : Shield;
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      <PageHeader
        title="Usuarios"
        description="Gestión de usuarios y roles del sistema."
        actions={
          <Button icon={UserPlus} size="sm" onClick={() => setShowCreate(true)}>
            Nuevo usuario
          </Button>
        }
      />

      <div className="flex items-center justify-between gap-3">
        <Input
          icon={Search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o email..."
          className="sm:max-w-xs"
        />
        <p className="shrink-0 text-sm text-muted-darker">
          {search ? `${filtered.length} de ${users.length}` : `${users.length} usuario(s)`}
        </p>
      </div>

      <EntityList
        rows={filtered}
        rowKey={(u) => u.id}
        loading={loading}
        error={fetchError}
        onRetry={fetchUsers}
        emptyIcon={Users}
        emptyTitle={users.length === 0 ? "Sin usuarios" : "Sin resultados"}
        emptyDescription={
          users.length === 0
            ? "No hay usuarios registrados en el sistema."
            : "No se encontraron usuarios con ese criterio."
        }
        renderRow={(u) => {
          const perf = performanceByUserId.get(u.id);
          return (
            <>
              <EntityRow
                leading={<EntityAvatar id={u.id} name={u.name ?? u.email} size="sm" />}
                title={u.name ?? "—"}
                badges={
                  <Badge tone={u.role === "admin" ? "warning" : u.role === "ejecutivo" ? "info" : "neutral"} size="sm">
                    {u.role === "admin" ? "Admin" : u.role === "ejecutivo" ? "Ejecutivo" : "Usuario"}
                  </Badge>
                }
                subtitle={
                  <>
                    <span className="font-mono">{u.email}</span> · {u.waAccounts.length} cuenta(s)
                  </>
                }
                meta={
                  <>
                    {perf && perf.resolvedCount > 0 && (
                      <span title="Chats resueltos · tiempo promedio de primera respuesta">
                        {perf.resolvedCount} resueltos
                        {perf.avgFirstResponseMinutes != null && ` · ${perf.avgFirstResponseMinutes}min 1ra resp.`}
                      </span>
                    )}
                    <span className="font-mono">
                      {formatDate(u.createdAt, { day: "2-digit", month: "short", year: "numeric" })}
                    </span>
                  </>
                }
              />
              <span className="shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={nextRoleIcon(u.role)}
                  onClick={() => toggleRole(u.id, u.role)}
                  disabled={togglingId === u.id}
                  className={u.role === "admin" ? "text-warning" : "text-muted-darker"}
                >
                  {togglingId === u.id ? <Spinner /> : `Hacer ${nextRoleLabel(u.role)}`}
                </Button>
              </span>
            </>
          );
        }}
        rowActions={(u) => (
          <>
            <DropdownItem icon={Users} onClick={() => { window.location.href = "/estadisticas"; }}>
              Ver desempeño
            </DropdownItem>
            <DropdownItem icon={Trash2} danger onClick={() => setDeleteTarget(u)}>
              Eliminar usuario
            </DropdownItem>
          </>
        )}
      />

      <UserFormModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={fetchUsers}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Eliminar usuario"
        description={
          deleteTarget && deleteTarget.waAccounts.length > 0
            ? `${deleteTarget.name ?? deleteTarget.email} es dueño de ${deleteTarget.waAccounts.length} cuenta(s) de WhatsApp — eliminarlo también elimina esas cuentas y todos sus chats, mensajes y campañas. No se puede deshacer.`
            : "Esta acción elimina permanentemente al usuario. No se puede deshacer."
        }
        confirmLabel="Eliminar"
        tone="danger"
        loading={deleting}
      />
    </div>
  );
}
