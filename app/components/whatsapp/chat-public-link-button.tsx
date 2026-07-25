"use client";

import { useState, useCallback, useEffect } from "react";
import { Link as LinkIcon, Copy, Trash2 } from "lucide-react";
import { Dropdown, DropdownButton } from "@/app/components/ui/dropdown";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { ConfirmDialog } from "@/app/components/ui/confirm-dialog";
import { useToast } from "@/app/components/ui/toast";

export function ChatPublicLinkButton({ chatId }: { chatId: string }) {
  const { success, error: toastError } = useToast();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/whatsapp/chats/${chatId}/public-link`);
      const data = await res.json();
      if (res.ok) setUrl(data.url);
    } catch {
      // El popover simplemente se queda mostrando "Generar link" — no hay
      // nada crítico que perder por un fallo silencioso al abrir.
    }
  }, [chatId]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh when dropdown opens
    fetchStatus();
  }, [open, fetchStatus]);

  async function handleGenerate() {
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/chats/${chatId}/public-link`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al generar el link");
      setUrl(data.url);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al generar el link");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    success("Link copiado");
  }

  async function handleRevoke() {
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/chats/${chatId}/public-link`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Error al revocar el link");
      }
      setUrl(null);
      success("Link revocado");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al revocar el link");
    } finally {
      setLoading(false);
      setConfirmRevoke(false);
    }
  }

  return (
    <>
      <Dropdown
        open={open}
        onOpenChange={setOpen}
        align="right"
        trigger={<DropdownButton label="Link público" icon={LinkIcon} size="sm" />}
      >
        <div className="p-3 w-80 space-y-3">
          {url ? (
            <>
              <p className="text-xs text-muted-darker">
                Cualquiera con este link puede ver la conversación, sin iniciar sesión. Solo lectura.
              </p>
              <div className="flex gap-2">
                <Input value={url} readOnly className="flex-1" inputClassName="text-xs" />
                <Button size="sm" variant="secondary" icon={Copy} onClick={handleCopy} title="Copiar" />
              </div>
              <Button
                size="sm"
                variant="danger"
                icon={Trash2}
                onClick={() => setConfirmRevoke(true)}
                disabled={loading}
              >
                Revocar link
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-darker">
                Genera un link de solo lectura para compartir esta conversación sin dar acceso al sistema.
              </p>
              <Button size="sm" onClick={handleGenerate} disabled={loading}>
                Generar link
              </Button>
            </>
          )}
        </div>
      </Dropdown>

      <ConfirmDialog
        open={confirmRevoke}
        onClose={() => setConfirmRevoke(false)}
        title="Revocar link público"
        description="El link actual dejará de funcionar de inmediato. Podrás generar uno nuevo cuando quieras, pero será una URL distinta."
        confirmLabel="Revocar"
        tone="danger"
        onConfirm={handleRevoke}
      />
    </>
  );
}
