"use client";

import { useState, useEffect, useCallback } from "react";
import { Drawer } from "@/app/components/ui/drawer";
import { Textarea } from "@/app/components/ui/textarea";
import { Button } from "@/app/components/ui/button";
import { Spinner } from "@/app/components/ui/spinner";
import { useToast } from "@/app/components/ui/toast";

interface Note {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string | null };
}

interface Assignee {
  id: string;
  name: string | null;
  email: string;
}

export function ChatNotesDrawer({
  chatId,
  chatTitle,
  onClose,
}: {
  chatId: string;
  chatTitle: string;
  onClose: () => void;
}) {
  const { error: toastError } = useToast();
  const [notes, setNotes] = useState<Note[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    try {
      const [notesRes, assigneesRes] = await Promise.all([
        fetch(`/api/whatsapp/chats/${chatId}/notes`),
        fetch(`/api/whatsapp/chats/${chatId}/assignees`),
      ]);
      const notesData = await notesRes.json();
      const assigneesData = await assigneesRes.json();
      if (Array.isArray(notesData)) setNotes(notesData);
      if (Array.isArray(assigneesData)) setAssignees(assigneesData);
    } catch {
      toastError("Error al cargar notas");
    } finally {
      setLoading(false);
    }
  }, [chatId, toastError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; fetchNotes also used for manual refresh
    fetchNotes();
  }, [fetchNotes]);

  async function handleAddNote() {
    if (!newNote.trim()) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/whatsapp/chats/${chatId}/notes`, {
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

  const lastAtIndex = newNote.lastIndexOf("@");
  const textAfterAt = lastAtIndex >= 0 ? newNote.slice(lastAtIndex + 1) : "";
  const mentionQuery = lastAtIndex >= 0 && !/[\s\n]/.test(textAfterAt) ? textAfterAt.toLowerCase() : null;
  const mentionSuggestions = mentionQuery !== null
    ? assignees.filter((a) => (a.name ?? a.email.split("@")[0]).toLowerCase().replace(/\s+/g, "").startsWith(mentionQuery)).slice(0, 6)
    : [];

  function insertMention(a: Assignee) {
    const handle = (a.name ?? a.email.split("@")[0]).replace(/\s+/g, "");
    setNewNote(`${newNote.slice(0, lastAtIndex)}@${handle} `);
  }

  return (
    <Drawer open onClose={onClose} side="right" title={`Notas internas — ${chatTitle}`} width="w-96">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <div className="p-4 space-y-3">
          <div className="relative space-y-2">
            {mentionSuggestions.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-1.5 rounded-lg border border-border bg-surface shadow-lg overflow-hidden z-10">
                {mentionSuggestions.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => insertMention(a)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-surface-light transition-colors border-b border-border last:border-b-0"
                  >
                    <span className="font-medium">{a.name ?? a.email}</span>
                  </button>
                ))}
              </div>
            )}
            <Textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Agregar una nota interna... usa @nombre para mencionar"
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
                  <p className="text-[11px] text-muted-darker mt-1.5">
                    {note.author.name ?? "Usuario"} · {new Date(note.createdAt).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
