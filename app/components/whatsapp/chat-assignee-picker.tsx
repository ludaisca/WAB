"use client";

import { useState, useEffect, useCallback } from "react";
import { UserCheck } from "lucide-react";
import { Dropdown, DropdownItem, DropdownButton } from "@/app/components/ui/dropdown";
import { useToast } from "@/app/components/ui/toast";

interface Assignee {
  id: string;
  name: string | null;
  email: string;
}

export function ChatAssigneePicker({
  chatId,
  assignedTo,
  onAssigned,
}: {
  chatId: string;
  assignedTo: { id: string; name: string | null } | null;
  onAssigned: (assignee: { id: string; name: string | null } | null) => void;
}) {
  const { error: toastError } = useToast();
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [open, setOpen] = useState(false);

  const fetchAssignees = useCallback(async () => {
    try {
      const res = await fetch(`/api/whatsapp/chats/${chatId}/assignees`);
      const data = await res.json();
      if (Array.isArray(data)) setAssignees(data);
    } catch {
      toastError("Error al cargar usuarios");
    }
  }, [chatId, toastError]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch when dropdown opens; fetchAssignees also called each time it reopens
    fetchAssignees();
  }, [open, fetchAssignees]);

  async function handleAssign(assigneeId: string | null) {
    try {
      const res = await fetch(`/api/whatsapp/chats/${chatId}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedToId: assigneeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al asignar");
      onAssigned(data.assignedTo ?? null);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al asignar");
    }
  }

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      align="right"
      trigger={
        <DropdownButton
          label={assignedTo?.name ?? "Sin asignar"}
          icon={UserCheck}
          size="sm"
        />
      }
    >
      <DropdownItem onClick={() => handleAssign(null)}>Sin asignar</DropdownItem>
      {assignees.map((a) => (
        <DropdownItem key={a.id} onClick={() => handleAssign(a.id)}>
          {a.name ?? a.email}
        </DropdownItem>
      ))}
    </Dropdown>
  );
}
