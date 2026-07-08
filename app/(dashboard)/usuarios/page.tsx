"use client";

import { useState, useEffect, useCallback } from "react";
import { Users as UsersIcon, Shield, ShieldOff, Plus, UserPlus } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { FormField } from "@/app/components/ui/form-field";
import { Spinner } from "@/app/components/ui/spinner";
import { useToast } from "@/app/components/ui/toast";

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
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [creating, setCreating] = useState(false);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/usuarios");
      const data = await res.json();
      if (Array.isArray(data)) setUsers(data);
      else if (data.error) toastError(data.error);
    } catch {
      toastError("Error al cargar usuarios");
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  async function toggleRole(userId: string, currentRole: string) {
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
  }

  function nextRoleLabel(role: string): string {
    const labels: Record<string, string> = { user: "Ejecutivo", ejecutivo: "Admin", admin: "Usuario" };
    return labels[role] ?? "Usuario";
  }

  function nextRoleIcon(role: string) {
    return role === "admin" ? ShieldOff : Shield;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!newName.trim()) errors.name = "Requerido";
    if (!newEmail.trim()) errors.email = "Requerido";
    if (!newPassword || newPassword.length < 6) errors.password = "Mínimo 6 caracteres";
    setCreateErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setCreating(true);
    try {
      const res = await fetch("/api/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          email: newEmail.trim().toLowerCase(),
          password: newPassword,
          role: newRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      success("Usuario creado");
      setNewName(""); setNewEmail(""); setNewPassword(""); setNewRole("user");
      setShowCreate(false);
      fetchUsers();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al crear");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usuarios</h1>
          <p className="mt-1 text-sm text-muted">Gestión de usuarios y roles del sistema.</p>
        </div>
        <Button icon={UserPlus} size="sm" onClick={() => setShowCreate(!showCreate)}>
          Nuevo usuario
        </Button>
      </div>

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle>Crear usuario</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Nombre" required error={createErrors.name}>
                  {(id) => <Input id={id} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre completo" error={createErrors.name} />}
                </FormField>
                <FormField label="Email" required error={createErrors.email}>
                  {(id) => <Input id={id} type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="usuario@email.com" error={createErrors.email} />}
                </FormField>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Contraseña" required error={createErrors.password}>
                  {(id) => <Input id={id} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Mínimo 6 caracteres" error={createErrors.password} />}
                </FormField>
                <FormField label="Rol">
                  {(id) => (
                    <Select id={id} value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                      <option value="user">Usuario</option>
                      <option value="ejecutivo">Ejecutivo</option>
                      <option value="admin">Admin</option>
                    </Select>
                  )}
                </FormField>
              </div>
              <div className="flex gap-2">
                <Button type="submit" icon={Plus} disabled={creating}>
                  {creating ? <Spinner /> : "Crear"}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Todos los usuarios ({users.length})</CardTitle>
        </CardHeader>
        <CardBody>
          {loading ? (
            <div className="flex items-center justify-center py-8"><Spinner /></div>
          ) : (
            <div className="overflow-x-auto -mx-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-border">
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-darker uppercase tracking-wider">Usuario</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-darker uppercase tracking-wider">Email</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-darker uppercase tracking-wider">Rol</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-darker uppercase tracking-wider">Cuentas</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-darker uppercase tracking-wider">Registro</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-darker uppercase tracking-wider w-12" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-surface-light/40 transition-colors">
                      <td className="px-5 py-3 font-medium text-sm">{u.name ?? "—"}</td>
                      <td className="px-4 py-3 text-xs font-mono">{u.email}</td>
                      <td className="px-4 py-3">
                        <Badge tone={u.role === "admin" ? "warning" : u.role === "ejecutivo" ? "info" : "neutral"} size="sm">
                          {u.role === "admin" ? "Admin" : u.role === "ejecutivo" ? "Ejecutivo" : "Usuario"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs">{u.waAccounts.length}</td>
                      <td className="px-4 py-3 text-xs text-muted-darker">
                        {new Date(u.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-4 py-3 text-right">
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
