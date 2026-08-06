"use client";

import { Drawer } from "@/app/components/ui/drawer";
import { ContactRecord } from "./contact-record";

// Shell delgado: todo el fetch/estado/acciones vive en <ContactRecord>, que
// también se monta como el tercer panel del inbox (Fase 5) — un solo
// componente de contenido, dos anfitriones (drawer aquí, panel fijo allá).
export function ContactDrawer({
  contactId,
  onClose,
  onUpdated,
}: {
  contactId: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  return (
    <Drawer open onClose={onClose} side="right" title="Contacto" width="w-96">
      <div className="p-4">
        <ContactRecord contactId={contactId} onUpdated={onUpdated} />
      </div>
    </Drawer>
  );
}
