"use client";

import { useState, useEffect, useCallback } from "react";
import { Tag as TagIcon, Plus } from "lucide-react";
import { Dropdown, DropdownButton } from "@/app/components/ui/dropdown";
import { MultiSelect } from "@/app/components/ui/multi-select";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { useToast } from "@/app/components/ui/toast";

interface TagOption {
  id: string;
  name: string;
  color: string;
}

export function ChatTagPicker({ chatId }: { chatId: string }) {
  const { error: toastError } = useToast();
  const [open, setOpen] = useState(false);
  const [allTags, setAllTags] = useState<TagOption[]>([]);
  const [chatTags, setChatTags] = useState<TagOption[]>([]);
  const [newTagName, setNewTagName] = useState("");

  const fetchAll = useCallback(async () => {
    try {
      const [allRes, chatRes] = await Promise.all([
        fetch("/api/whatsapp/tags"),
        fetch(`/api/whatsapp/chats/${chatId}/tags`),
      ]);
      const allData = await allRes.json();
      const chatData = await chatRes.json();
      if (Array.isArray(allData)) setAllTags(allData);
      if (Array.isArray(chatData)) setChatTags(chatData);
    } catch {
      toastError("Error al cargar etiquetas");
    }
  }, [chatId, toastError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on chat change / dropdown open
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh when dropdown opens
    fetchAll();
  }, [open, fetchAll]);

  async function handleTagsChange(tagIds: string[]) {
    const currentIds = chatTags.map((t) => t.id);
    const toAdd = tagIds.filter((id) => !currentIds.includes(id));
    const toRemove = currentIds.filter((id) => !tagIds.includes(id));

    try {
      await Promise.all([
        ...toAdd.map((tagId) =>
          fetch(`/api/whatsapp/chats/${chatId}/tags`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tagId }),
          })
        ),
        ...toRemove.map((tagId) =>
          fetch(`/api/whatsapp/chats/${chatId}/tags?tagId=${tagId}`, {
            method: "DELETE",
          })
        ),
      ]);
      setChatTags(allTags.filter((t) => tagIds.includes(t.id)));
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
      setAllTags((prev) => [...prev, data]);
      setNewTagName("");
      await handleTagsChange([...chatTags.map((t) => t.id), data.id]);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al crear etiqueta");
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      {chatTags.map((tag) => (
        <Badge key={tag.id} tone="accent" size="sm">{tag.name}</Badge>
      ))}
      <Dropdown
        open={open}
        onOpenChange={setOpen}
        align="right"
        trigger={<DropdownButton label="Etiquetas" icon={TagIcon} size="sm" />}
      >
        <div className="p-3 w-64 space-y-2">
          <MultiSelect
            options={allTags.map((t) => ({ value: t.id, label: t.name }))}
            value={chatTags.map((t) => t.id)}
            onChange={handleTagsChange}
            placeholder="Sin etiquetas"
          />
          <div className="flex gap-2">
            <Input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="Nueva etiqueta..."
              className="flex-1"
            />
            <Button size="sm" variant="secondary" icon={Plus} onClick={handleCreateTag} />
          </div>
        </div>
      </Dropdown>
    </div>
  );
}
