"use client";

import { useState, useEffect, useCallback } from "react";
import { Shield, ShieldOff, UserPlus, Users } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Spinner } from "@/app/components/ui/spinner";
import { PageHeader } from "@/app/components/ui/page-header";
import { EntityList, EntityRow } from "@/app/components/ui/entity-list";
import { EntityAvatar } from "@/app/components/ui/avatar";
import { useToast } from "@/app/components/ui/toast";
import { UserFormModal } from "./_form";

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

  function nextRoleLabel(role: string): string {
    const labels: Record<string, string> = { user: "Ejecutivo", ejecutivo: "Admin", admin: "Usuario" };
    return labels[role] ?? "Usuario";
  }

  function nextRoleIcon(role: string) {
    return role === "admin" ? ShieldOff : Shield;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuarios"
        description="Gestión de usuarios y roles del sistema."
        actions={
          <Button icon={UserPlus} size="sm" onClick={() => setShowCreate(true)}>
            Nuevo usuario
          </Button>
        }
      />

      <p className="text-sm text-muted-darker">Todos los usuarios ({users.length})</p>

      <EntityList
        rows={users}
        rowKey={(u) => u.id}
        loading={loading}
        error={fetchError}
        onRetry={fetchUsers}
        emptyIcon={Users}
        emptyTitle="Sin usuarios"
        emptyDescription="No hay usuarios registrados en el sistema."
        renderRow={(u) => (
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
                <span className="font-mono">
                  {new Date(u.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
                </span>
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
        )}
      />

      <UserFormModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={fetchUsers}
      />
    </div>
  );
}
