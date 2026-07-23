"use client";

import { useState } from "react";
import { Modal } from "@/app/components/ui/modal";
import { Button } from "@/app/components/ui/button";
import { Banner } from "@/app/components/ui/banner";
import { Input } from "@/app/components/ui/input";
import { RESTORE_CONFIRMATION_PHRASE } from "@/lib/backup/constants";
import type { RestorePreviewResponse } from "./_types";

interface Props {
  open: boolean;
  onClose: () => void;
  preview: RestorePreviewResponse | null;
  onConfirm: (confirmationPhrase: string) => void;
  loading: boolean;
}

export function RestoreConfirmModal({ open, onClose, preview, onConfirm, loading }: Props) {
  const [phrase, setPhrase] = useState("");
  const [understood, setUnderstood] = useState(false);

  const canConfirm = phrase === RESTORE_CONFIRMATION_PHRASE && understood && !loading;

  function handleClose() {
    if (loading) return;
    setPhrase("");
    setUnderstood(false);
    onClose();
  }

  if (!preview) return null;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Restaurar respaldo"
      size="lg"
      persistent={loading}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={handleClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => onConfirm(phrase)}
            disabled={!canConfirm}
            loading={loading}
          >
            Restaurar y reemplazar todo
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Banner tone="danger" title="Esta acción reemplaza TODOS los datos actuales">
          Se creará automáticamente un respaldo de seguridad del estado actual justo antes de sobrescribir, pero la
          restauración en sí es irreversible salvo cargando ese respaldo de seguridad manualmente después. El
          sistema entrará en modo mantenimiento mientras dure el proceso.
        </Banner>

        <div className="text-sm space-y-1">
          <p><span className="text-muted-darker">Archivo:</span> {preview.sourceFilename}</p>
          <p><span className="text-muted-darker">Generado:</span> {new Date(preview.manifest.createdAt).toLocaleString("es-MX")}</p>
          <p><span className="text-muted-darker">Tipo de respaldo:</span> {preview.manifest.type}</p>
          <p><span className="text-muted-darker">Medios incluidos:</span> {preview.manifest.mediaFileCount} archivos</p>
        </div>

        {preview.tableCountDiffs.length > 0 && (
          <div className="text-xs bg-surface-light rounded-lg p-3 space-y-1 max-h-32 overflow-y-auto">
            <p className="text-muted-darker font-medium mb-1">Diferencias respecto al estado actual:</p>
            {preview.tableCountDiffs.map((d) => (
              <p key={d.table} className="font-mono">
                {d.table}: actual {d.current} → backup {d.backup}
              </p>
            ))}
          </div>
        )}

        {preview.encryptionKeyMismatch && (
          <Banner tone="warning" title="La clave de cifrado no coincide con la de este servidor">
            Este respaldo se generó en una instancia con un ENCRYPTION_KEY distinto. Los tokens de acceso de
            WhatsApp y las API keys de IA quedarán inválidos tras restaurar — tendrás que reconfigurarlos
            manualmente después. El resto de los datos (chats, contactos, campañas, mensajes, medios) se restaura
            sin problema.
          </Banner>
        )}

        <div className="space-y-3 pt-2 border-t border-border">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              className="mt-0.5"
            />
            Entiendo que esta acción reemplaza todos los datos actuales y no se puede deshacer directamente.
          </label>

          <div>
            <p className="text-xs text-muted-darker mb-1.5">
              Escribe <span className="font-mono font-semibold text-foreground">{RESTORE_CONFIRMATION_PHRASE}</span> para confirmar:
            </p>
            <Input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder={RESTORE_CONFIRMATION_PHRASE}
              disabled={loading}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
