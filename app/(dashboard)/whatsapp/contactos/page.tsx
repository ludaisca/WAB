"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Search, RefreshCw, Contact as ContactIcon } from "lucide-react";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
import { EntityList, EntityRow } from "@/app/components/ui/entity-list";
import { EntityAvatar } from "@/app/components/ui/avatar";
import { Pagination } from "@/app/components/ui/pagination";
import { useToast } from "@/app/components/ui/toast";
import { ContactDrawer } from "@/app/components/whatsapp/contact-drawer";

const PAGE_SIZE = 25;

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

function phoneFromJid(remoteJid: string): string {
  return remoteJid.split("@")[0];
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
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [leadStatusFilter, setLeadStatusFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset pagination when filters change
    setPage(1);
  }, [search, leadStatusFilter, accountFilter]);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (leadStatusFilter) params.set("leadStatus", leadStatusFilter);
      if (accountFilter) params.set("accountId", accountFilter);
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      const res = await fetch(`/api/whatsapp/contacts?${params.toString()}`);
      const data = await res.json();
      if (Array.isArray(data.items)) {
        setContacts(data.items);
        setTotal(data.total ?? 0);
      } else throw new Error(data.error ?? "Error al cargar contactos");
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Error al cargar contactos");
    } finally {
      setLoading(false);
    }
  }, [search, leadStatusFilter, accountFilter, page]);

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
      <PageHeader
        title="Contactos"
        description="Etiquetas, estado de lead y notas por contacto."
        actions={
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={fetchContacts}>
            Actualizar
          </Button>
        }
      />

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            icon={Search}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
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

        <EntityList
          rows={contacts}
          rowKey={(c) => c.id}
          loading={loading}
          error={fetchError}
          onRetry={fetchContacts}
          onRowClick={(c) => setSelectedId(c.id)}
          emptyIcon={ContactIcon}
          emptyTitle="Sin contactos"
          emptyDescription="Los contactos se crean automáticamente cuando recibes un mensaje de WhatsApp."
          renderRow={(contact) => {
            const badge = LEAD_STATUS_BADGE[contact.leadStatus] ?? { label: contact.leadStatus, tone: "neutral" as const };
            const account = accounts.find((a) => a.id === contact.accountId);
            const name = contact.name ?? contact.remoteJid;
            return (
              <EntityRow
                leading={<EntityAvatar id={contact.accountId} name={name} size="sm" />}
                title={name}
                badges={
                  <span className="flex shrink-0 items-center gap-1">
                    <Badge tone={badge.tone} size="sm">{badge.label}</Badge>
                    {contact.tags.map(({ tag }) => (
                      <Badge key={tag.id} tone="accent" size="sm" className="hidden md:inline-flex">{tag.name}</Badge>
                    ))}
                  </span>
                }
                subtitle={
                  <>
                    <span className="font-mono">{phoneFromJid(contact.remoteJid)}</span>
                    {accounts.length > 1 && account && <> · {account.name}</>}
                    {contact._count.notes > 0 && <> · {contact._count.notes} nota(s)</>}
                  </>
                }
                meta={
                  <>
                    <span className="font-mono">
                      {contact.chat?.lastMessageAt
                        ? new Date(contact.chat.lastMessageAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                        : "—"}
                    </span>
                    {contact.chat && (
                      <Link
                        href={`/whatsapp/chat/${contact.accountId}/${contact.chat.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-accent hover:underline"
                      >
                        Ver chat
                      </Link>
                    )}
                  </>
                }
              />
            );
          }}
        />
        {total > PAGE_SIZE && (
          <div className="flex justify-center pt-2">
            <Pagination
              currentPage={page}
              totalPages={Math.ceil(total / PAGE_SIZE)}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>

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
