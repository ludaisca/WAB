"use client";

import { Plus } from "lucide-react";
import { Button } from "@/app/components/ui/button";

export function AddAccountButton() {
  return (
    <Button href="/whatsapp/cuentas/nueva" icon={Plus} size="sm">
      Agregar número
    </Button>
  );
}
