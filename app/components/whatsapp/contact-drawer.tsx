"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus } from "lucide-react";
import { Drawer } from "@/app/components/ui/drawer";
import { Banner } from "@/app/components/ui/banner";
import { Select } from "@/app/components/ui/select";
import { MultiSelect } from "@/app/components/ui/multi-select";
import { Textarea } from "@/app/components/ui/textarea";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { Spinner } from "@/app/components/ui/spinner";
import { useToast } from "@/app/components/ui/toast";

interface ContactDetail {
  id: string;
  name: string | null;
  remoteJid: string;
  leadStatus: string;
  tags: Array<{ tag: { id: string; name: string; color: string } }>;
}

interface Note {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string | null };
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

export function ContactDrawer({
  contactId,
  onClose,
  onUpdated,
}: {
  contactId: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { error: toastError } = useToast();
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [allTags, setAllTags] = useState<TagOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [contactRes, notesRes, tagsRes] = await Promise.all([
        fetch(`/api/whatsapp/contacts/${contactId}`),
        fetch(`/api/whatsapp/contacts/${contactId}/notes`),
        fetch(`/api/whatsapp/tags`),
      ]);
      const contactData = await contactRes.json();
      if (!contactRes.ok) throw new Error(contactData.error ?? "Error al cargar el contacto");
      const notesData = await notesRes.json();
      const tagsData = await tagsRes.json();
      setContact(contactData);
      if (Array.isArray(notesData)) setNotes(notesData);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; fetchAll also used for manual refresh
    fetchAll();
  }, [fetchAll]);

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
        // Append the tag object we already have in hand instead of routing through
        // handleTagsChange, which rebuilds contact.tags from `allTags` — that state
        // update from setAllTags above hasn't flushed yet, so the new tag wouldn't
        // be in it and the drawer would show "Sin etiquetas" despite saving fine.
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
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al agregar nota");
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <Drawer open onClose={onClose} side="right" title={contact?.name ?? contact?.remoteJid ?? "Contacto"} width="w-96">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      ) : loadError || !contact ? (
        <div className="p-4">
          <Banner tone="danger">{loadError ?? "No se pudo cargar el contacto"}</Banner>
        </div>
      ) : (
        <div className="p-4 space-y-5">
          <div>
            <label className="block text-xs font-medium text-muted-darker mb-1.5">Estado de lead</label>
            <Select value={contact.leadStatus} onChange={(e) => handleLeadStatusChange(e.target.value)}>
              {LEAD_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-darker mb-1.5">Etiquetas</label>
            <MultiSelect
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
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-darker mb-1.5">Notas internas</label>
            <div className="space-y-2 mb-3">
              <Textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Agregar una nota..."
                rows={3}
              />
              <Button size="sm" onClick={handleAddNote} disabled={savingNote || !newNote.trim()}>
                {savingNote ? "Guardando..." : "Agregar nota"}
              </Button>
            </div>
            <div className="space-y-3">
              {notes.length === 0 ? (
                <p className="text-xs text-muted-darker">Sin notas todavía.</p>
              ) : (
                notes.map((note) => (
                  <div key={note.id} className="rounded-lg border border-border bg-surface-light p-3">
                    <p className="text-sm text-foreground whitespace-pre-wrap">{note.body}</p>
                    <p className="text-xs text-muted-darker mt-1.5">
                      {note.author.name ?? "Usuario"} · {new Date(note.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
