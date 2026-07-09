"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Search, RefreshCw, Contact as ContactIcon } from "lucide-react";
import { Card } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Spinner } from "@/app/components/ui/spinner";
import { useToast } from "@/app/components/ui/toast";
import { ContactDrawer } from "@/app/components/whatsapp/contact-drawer";

interface AccountOption {
  id: string;
  name: string;
  phoneNumber: string | null;
}

interface ContactRow {
  id: string;
  accountId: string;
  remoteJid: string;
  name: string | null;
  leadStatus: string;
  updatedAt: string;
  tags: Array<{ tag: { id: string; name: string; color: string } }>;
  chat: { id: string; unreadCount: number; lastMessageAt: string | null } | null;
  _count: { notes: number };
}

const LEAD_STATUS_BADGE: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" | "accent" }> = {
  NEW: { label: "Nuevo", tone: "info" },
  CONTACTED: { label: "Contactado", tone: "warning" },
  QUALIFIED: { label: "Calificado", tone: "accent" },
  CUSTOMER: { label: "Cliente", tone: "success" },
  LOST: { label: "Perdido", tone: "danger" },
};

export default function ContactosPage() {
  const { error: toastError } = useToast();
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [leadStatusFilter, setLeadStatusFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (leadStatusFilter) params.set("leadStatus", leadStatusFilter);
      if (accountFilter) params.set("accountId", accountFilter);
      const res = await fetch(`/api/whatsapp/contacts?${params.toString()}`);
      const data = await res.json();
      if (Array.isArray(data)) setContacts(data);
    } catch {
      toastError("Error al cargar contactos");
    } finally {
      setLoading(false);
    }
  }, [search, leadStatusFilter, accountFilter, toastError]);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/accounts");
      const data = await res.json();
      if (Array.isArray(data)) setAccounts(data);
    } catch {
      toastError("Error al cargar cuentas");
    }
  }, [toastError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount/filter-change; fetchContacts also used for manual refresh
    fetchContacts();
  }, [fetchContacts]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    fetchAccounts();
  }, [fetchAccounts]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contactos</h1>
          <p className="mt-1 text-sm text-muted">
            Etiquetas, estado de lead y notas por contacto.
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={fetchContacts}>
          Actualizar
        </Button>
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
          {accounts.length > 1 && (
            <Select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              className="sm:max-w-[200px]"
            >
              <option value="">Todos los números</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}{acc.phoneNumber ? ` · ${acc.phoneNumber}` : ""}
                </option>
              ))}
            </Select>
          )}
          <Select
            value={leadStatusFilter}
            onChange={(e) => setLeadStatusFilter(e.target.value)}
            placeholder="Todos los estados"
            className="sm:max-w-[180px]"
          >
            <option value="">Todos los estados</option>
            {Object.entries(LEAD_STATUS_BADGE).map(([value, { label }]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner />
          </div>
        ) : contacts.length === 0 ? (
          <EmptyState
            icon={ContactIcon}
            title="Sin contactos"
            description="Los contactos se crean automáticamente cuando recibes un mensaje de WhatsApp."
          />
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-border">
                  <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-darker uppercase tracking-wider">Nombre</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-darker uppercase tracking-wider">Estado</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-darker uppercase tracking-wider">Etiquetas</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-darker uppercase tracking-wider">Notas</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-darker uppercase tracking-wider">Última actividad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {contacts.map((contact) => {
                  const badge = LEAD_STATUS_BADGE[contact.leadStatus] ?? { label: contact.leadStatus, tone: "neutral" as const };
                  return (
                    <tr
                      key={contact.id}
                      className="hover:bg-surface-light/40 transition-colors cursor-pointer"
                      onClick={() => setSelectedId(contact.id)}
                    >
                      <td className="px-5 py-3">
                        <span className="font-medium text-foreground">{contact.name ?? contact.remoteJid}</span>
                        {contact.chat && (
                          <Link
                            href={`/whatsapp/chat/${contact.accountId}/${contact.chat.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="ml-2 text-xs text-accent hover:underline"
                          >
                            Ver chat
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={badge.tone} size="sm">{badge.label}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {contact.tags.map(({ tag }) => (
                            <Badge key={tag.id} tone="accent" size="sm">{tag.name}</Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-darker">{contact._count.notes}</td>
                      <td className="px-4 py-3 text-xs text-muted-darker">
                        {contact.chat?.lastMessageAt
                          ? new Date(contact.chat.lastMessageAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selectedId && (
        <ContactDrawer
          contactId={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdated={fetchContacts}
        />
      )}
    </div>
  );
}
