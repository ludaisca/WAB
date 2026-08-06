"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Copy } from "lucide-react";
import { EntityAvatar } from "@/app/components/ui/avatar";
import { Banner } from "@/app/components/ui/banner";
import { Badge } from "@/app/components/ui/badge";
import { Select } from "@/app/components/ui/select";
import { MultiSelect } from "@/app/components/ui/multi-select";
import { Textarea } from "@/app/components/ui/textarea";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { FormField } from "@/app/components/ui/form-field";
import { SkeletonDetail } from "@/app/components/ui/skeleton";
import { Tabs } from "@/app/components/ui/tabs";
import { DefinitionList } from "@/app/components/ui/definition-list";
import { useToast } from "@/app/components/ui/toast";
import { formatDate } from "@/lib/timezone";
import { formatLeadId } from "@/lib/whatsapp/lead-id";
import { labelText, labelTone, type ScoreDetails } from "@/lib/whatsapp/export-columns";
import { ContactTimeline } from "./contact-timeline";
import type { ActivityEvent, QualifiedDataEntry, ChatScoreEntry, ContactActivity } from "@/app/api/whatsapp/contacts/[id]/activity/route";

interface ContactDetail {
  id: string;
  accountId: string;
  name: string | null;
  realName: string | null;
  remoteJid: string;
  leadNumber: string | null;
  leadStatus: string;
  optedOutMarketing: boolean;
  blockedAt: string | null;
  blockedNote: string | null;
  account: { name: string; leadIdPrefix: string | null };
  tags: Array<{ tag: { id: string; name: string; color: string } }>;
}

interface TagOption {
  id: string;
  name: string;
  color: string;
}

const LEAD_STATUS_OPTIONS = [
  { value: "NEW", label: "Nuevo" },
  { value: "CONTACTED", label: "Contactado" },
  { value: "QUALIFIED", label: "Calificado" },
  { value: "CUSTOMER", label: "Cliente" },
  { value: "LOST", label: "Perdido" },
];

function phoneFromJid(remoteJid: string): string {
  return remoteJid.split("@")[0];
}

// qualifiedData es un blob libre por bot (sin esquema fijo — cada bot decide
// sus propias claves de sondeo, ver AGENTS.md) — se renderiza genérico.
function qualifiedDataRows(data: Record<string, unknown>) {
  return Object.entries(data).map(([key, value]) => ({
    label: key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
}

function scoreDetailRows(details: ScoreDetails) {
  const rows: Array<{ label: string; value: string }> = [];
  if (details.nombre_real) rows.push({ label: "Nombre real", value: details.nombre_real });
  if (details.tipo_lead) rows.push({ label: "Tipo de lead", value: details.tipo_lead });
  if (details.producto_interes) rows.push({ label: "Producto de interés", value: details.producto_interes });
  if (details.urgencia) rows.push({ label: "Urgencia", value: details.urgencia });
  if (details.presupuesto) rows.push({ label: "Presupuesto", value: details.presupuesto });
  if (details.tono_interes) rows.push({ label: "Tono de interés", value: details.tono_interes });
  if (details.nivel_interaccion) rows.push({ label: "Nivel de interacción", value: details.nivel_interaccion });
  if (details.necesidad_principal) rows.push({ label: "Necesidad principal", value: details.necesidad_principal });
  if (details.contexto_negocio) rows.push({ label: "Contexto de negocio", value: details.contexto_negocio });
  return rows;
}

export function ContactRecord({
  contactId,
  onUpdated,
}: {
  contactId: string;
  onUpdated: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [allTags, setAllTags] = useState<TagOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [blockNote, setBlockNote] = useState("");
  const [tab, setTab] = useState<"resumen" | "actividad">("resumen");

  const [activity, setActivity] = useState<ContactActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);

  const fetchActivity = useCallback(async () => {
    setActivityLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/contacts/${contactId}/activity`);
      const data = await res.json();
      if (res.ok) setActivity(data);
    } catch {
      // El timeline es un extra de contexto — un fallo aquí no debe tumbar
      // el resto del panel, así que se omite en silencio.
    } finally {
      setActivityLoading(false);
    }
  }, [contactId]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [contactRes, tagsRes] = await Promise.all([
        fetch(`/api/whatsapp/contacts/${contactId}`),
        fetch(`/api/whatsapp/tags`),
      ]);
      const contactData = await contactRes.json();
      if (!contactRes.ok) throw new Error(contactData.error ?? "Error al cargar el contacto");
      const tagsData = await tagsRes.json();
      setContact(contactData);
      if (Array.isArray(tagsData)) setAllTags(tagsData);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error al cargar el contacto";
      setLoadError(message);
      toastError(message);
    } finally {
      setLoading(false);
    }
  }, [contactId, toastError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount/contactId-change; fetchAll también se usa para refrescar manualmente
    fetchAll();
    fetchActivity();
  }, [fetchAll, fetchActivity]);

  async function handleLeadStatusChange(leadStatus: string) {
    if (!contact) return;
    setContact({ ...contact, leadStatus });
    try {
      const res = await fetch(`/api/whatsapp/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadStatus }),
      });
      if (!res.ok) throw new Error();
      onUpdated();
    } catch {
      toastError("Error al actualizar el estado");
    }
  }

  async function handleTagsChange(tagIds: string[]) {
    if (!contact) return;
    const currentIds = contact.tags.map((t) => t.tag.id);
    const toAdd = tagIds.filter((id) => !currentIds.includes(id));
    const toRemove = currentIds.filter((id) => !tagIds.includes(id));

    try {
      await Promise.all([
        ...toAdd.map((tagId) =>
          fetch(`/api/whatsapp/contacts/${contactId}/tags`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tagId }),
          })
        ),
        ...toRemove.map((tagId) =>
          fetch(`/api/whatsapp/contacts/${contactId}/tags?tagId=${tagId}`, {
            method: "DELETE",
          })
        ),
      ]);
      setContact({
        ...contact,
        tags: allTags.filter((t) => tagIds.includes(t.id)).map((tag) => ({ tag })),
      });
      onUpdated();
    } catch {
      toastError("Error al actualizar etiquetas");
    }
  }

  async function handleBlockToggle() {
    if (!contact) return;
    setBlocking(true);
    try {
      const isBlocked = !!contact.blockedAt;
      const res = await fetch(`/api/whatsapp/contacts/${contactId}/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: isBlocked ? "unblock" : "block",
          note: isBlocked ? null : blockNote.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al actualizar el bloqueo");
      setContact((prev) =>
        prev ? { ...prev, blockedAt: data.blockedAt ?? null, blockedNote: data.blockedNote ?? null } : prev
      );
      setBlockNote("");
      onUpdated();
      fetchActivity();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al actualizar el bloqueo");
    } finally {
      setBlocking(false);
    }
  }

  async function handleCreateTag() {
    if (!newTagName.trim()) return;
    try {
      const res = await fetch("/api/whatsapp/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTagName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al crear etiqueta");
      const newTag: TagOption = data;
      setAllTags((prev) => [...prev, newTag]);
      setNewTagName("");
      if (contact) {
        await fetch(`/api/whatsapp/contacts/${contactId}/tags`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tagId: newTag.id }),
        });
        // Se agrega el tag que ya se tiene en mano en vez de pasar por
        // handleTagsChange (que reconstruye contact.tags desde `allTags`) —
        // ese setAllTags de arriba todavía no se aplicó, así que el tag nuevo
        // no estaría ahí y el panel mostraría "Sin etiquetas" pese a guardar bien.
        setContact((prev) => prev && { ...prev, tags: [...prev.tags, { tag: newTag }] });
        onUpdated();
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al crear etiqueta");
    }
  }

  async function handleAddNote() {
    if (!newNote.trim()) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/whatsapp/contacts/${contactId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: newNote.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al agregar nota");
      setNewNote("");
      fetchActivity();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al agregar nota");
    } finally {
      setSavingNote(false);
    }
  }

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      success(`${label} copiado`);
    } catch {
      toastError(`No se pudo copiar ${label.toLowerCase()}`);
    }
  }

  if (loading) return <SkeletonDetail cards={2} />;
  if (loadError || !contact) return <Banner tone="danger">{loadError ?? "No se pudo cargar el contacto"}</Banner>;

  const displayName = contact.name ?? contact.remoteJid;
  const leadId = formatLeadId(contact.account.leadIdPrefix, contact.account.name, contact.leadNumber);
  const events: ActivityEvent[] = activity?.events ?? [];
  const qualified: QualifiedDataEntry[] = activity?.qualified ?? [];
  const scores: ChatScoreEntry[] = activity?.scores ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <EntityAvatar id={contact.accountId} name={displayName} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-foreground">{displayName}</p>
          {/* realName: nombre real aprendido por IA durante la conversación —
              distinto de `name` (viene del CSV/hoja de origen) — existía en la
              BD desde hace tiempo pero nunca se mostraba en ningún lado. */}
          {contact.realName && contact.realName !== contact.name && (
            <p className="truncate text-xs text-muted-darker">Nombre real: {contact.realName}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-darker">
              {phoneFromJid(contact.remoteJid)}
              <button
                onClick={() => copyToClipboard(phoneFromJid(contact.remoteJid), "Número")}
                className="text-muted-darker hover:text-foreground transition-colors"
                title="Copiar número"
              >
                <Copy size={11} />
              </button>
            </span>
            {leadId && (
              <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-darker">
                {leadId}
                <button
                  onClick={() => copyToClipboard(leadId, "ID de lead")}
                  className="text-muted-darker hover:text-foreground transition-colors"
                  title="Copiar ID de lead"
                >
                  <Copy size={11} />
                </button>
              </span>
            )}
          </div>
        </div>
      </div>

      {contact.optedOutMarketing && (
        <Banner tone="warning">
          Este contacto se dio de baja de mensajes de marketing por WhatsApp — no recibirá futuras campañas.
        </Banner>
      )}

      {contact.blockedAt && (
        <Banner tone="danger">
          Contacto bloqueado — el bot no responde y no recibe campañas, reactivaciones ni calificaciones.
          Sus mensajes siguen llegando aquí y puedes responderlos manualmente.
          {contact.blockedNote && <span className="block mt-1 opacity-90">Motivo: {contact.blockedNote}</span>}
        </Banner>
      )}

      <div className="rounded-lg border border-border bg-surface-light p-3 space-y-2">
        {!contact.blockedAt ? (
          <>
            <FormField label="Motivo del bloqueo (opcional)">
              {(id) => (
                <Input
                  id={id}
                  value={blockNote}
                  onChange={(e) => setBlockNote(e.target.value)}
                  placeholder="Ej: spam, número equivocado..."
                />
              )}
            </FormField>
            <Button variant="danger" size="sm" className="w-full" onClick={handleBlockToggle} disabled={blocking}>
              {blocking ? "Bloqueando..." : "Bloquear contacto"}
            </Button>
            <p className="text-[11px] text-muted-darker">
              El bot dejará de responderle y no recibirá campañas ni seguimientos automáticos.
            </p>
          </>
        ) : (
          <Button variant="secondary" size="sm" className="w-full" onClick={handleBlockToggle} disabled={blocking}>
            {blocking ? "Desbloqueando..." : "Desbloquear contacto"}
          </Button>
        )}
      </div>

      <FormField label="Estado de lead">
        {(id) => (
          <Select id={id} value={contact.leadStatus} onChange={(e) => handleLeadStatusChange(e.target.value)}>
            {LEAD_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField label="Etiquetas">
        {(id) => (
          <>
            <MultiSelect
              id={id}
              options={allTags.map((t) => ({ value: t.id, label: t.name }))}
              value={contact.tags.map((t) => t.tag.id)}
              onChange={handleTagsChange}
              placeholder="Sin etiquetas"
            />
            <div className="flex gap-2 mt-2">
              <Input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="Nueva etiqueta..."
                className="flex-1"
              />
              <Button size="sm" variant="secondary" icon={Plus} onClick={handleCreateTag}>
                Crear
              </Button>
            </div>
          </>
        )}
      </FormField>

      <FormField label="Agregar nota">
        {(id) => (
          <div className="space-y-2">
            <Textarea id={id} value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Escribe una nota..." rows={2} />
            <Button size="sm" onClick={handleAddNote} disabled={savingNote || !newNote.trim()}>
              {savingNote ? "Guardando..." : "Agregar nota"}
            </Button>
          </div>
        )}
      </FormField>

      <div>
        <Tabs
          items={[
            { value: "resumen", label: "Resumen" },
            { value: "actividad", label: "Actividad", count: events.length || undefined },
          ]}
          value={tab}
          onChange={(v) => setTab(v as "resumen" | "actividad")}
        />

        <div className="mt-4">
          {tab === "resumen" ? (
            <div className="space-y-5">
              {activityLoading ? (
                <p className="text-xs text-muted-darker">Cargando…</p>
              ) : qualified.length === 0 && scores.length === 0 ? (
                <p className="text-xs text-muted-darker">
                  Sin datos de sondeo o calificación todavía para la conversación de este contacto.
                </p>
              ) : (
                <>
                  {/* qualifiedData/summary: hallazgo más valioso del audit — la
                      tool registrar_dato_prospecto recopila esto en cada
                      conversación real y hasta ahora no aparecía en ningún
                      lado de la UI. */}
                  {qualified.map((q) => (
                    <div key={q.botId} className="space-y-2">
                      <p className="text-eyebrow font-medium uppercase tracking-wider text-muted-darker">
                        Sondeo · {q.botName}
                      </p>
                      {q.summary && <p className="text-sm text-foreground whitespace-pre-wrap">{q.summary}</p>}
                      {q.qualifiedData && Object.keys(q.qualifiedData).length > 0 && (
                        <DefinitionList rows={qualifiedDataRows(q.qualifiedData)} />
                      )}
                    </div>
                  ))}

                  {scores.map((s) => (
                    <div key={s.scorerId} className="space-y-2 border-t border-border pt-4 first:border-0 first:pt-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-eyebrow font-medium uppercase tracking-wider text-muted-darker">
                          {s.scorerName}
                        </p>
                        <Badge tone={labelTone(s.label)} size="sm">{labelText(s.label)} · {s.score}/100</Badge>
                      </div>
                      <p className="text-sm text-foreground whitespace-pre-wrap">{s.summary}</p>
                      {s.details && scoreDetailRows(s.details).length > 0 && (
                        <DefinitionList rows={scoreDetailRows(s.details)} />
                      )}
                      <p className="text-[11px] text-muted-darker">
                        Actualizado {formatDate(s.updatedAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  ))}
                </>
              )}
            </div>
          ) : (
            <ContactTimeline events={events} loading={activityLoading} />
          )}
        </div>
      </div>
    </div>
  );
}
