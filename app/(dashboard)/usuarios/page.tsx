"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Shield, ShieldOff, UserPlus, Users } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Spinner } from "@/app/components/ui/spinner";
import { PageHeader } from "@/app/components/ui/page-header";
import { Table, type TableColumn } from "@/app/components/ui/table";
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

  const columns: TableColumn<UserData>[] = useMemo(() => [
    {
      key: "name",
      header: "Usuario",
      render: (u) => <span className="font-medium text-sm">{u.name ?? "—"}</span>,
    },
    {
      key: "email",
      header: "Email",
      render: (u) => <span className="text-xs font-mono">{u.email}</span>,
      hideBelow: "sm",
    },
    {
      key: "role",
      header: "Rol",
      render: (u) => (
        <Badge tone={u.role === "admin" ? "warning" : u.role === "ejecutivo" ? "info" : "neutral"} size="sm">
          {u.role === "admin" ? "Admin" : u.role === "ejecutivo" ? "Ejecutivo" : "Usuario"}
        </Badge>
      ),
    },
    {
      key: "waAccounts",
      header: "Cuentas",
      render: (u) => <span className="text-xs">{u.waAccounts.length}</span>,
      hideBelow: "md",
    },
    {
      key: "createdAt",
      header: "Registro",
      render: (u) => (
        <span className="text-xs text-muted-darker">
          {new Date(u.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
        </span>
      ),
      hideBelow: "md",
    },
    {
      key: "actions",
      header: "",
      headerClassName: "text-right",
      cellClassName: "text-right",
      render: (u) => (
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
      ),
    },
  ], [togglingId, toggleRole]);

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

      <Card>
        <CardHeader>
          <CardTitle>Todos los usuarios ({users.length})</CardTitle>
        </CardHeader>
        <CardBody>
          <Table
            columns={columns}
            rows={users}
            rowKey={(u) => u.id}
            loading={loading}
            error={fetchError}
            onRetry={fetchUsers}
            emptyIcon={Users}
            emptyTitle="Sin usuarios"
            emptyDescription="No hay usuarios registrados en el sistema."
          />
        </CardBody>
      </Card>

      <UserFormModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={fetchUsers}
      />
    </div>
  );
}
