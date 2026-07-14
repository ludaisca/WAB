"use client";

import { Plus } from "lucide-react";
import { Button } from "@/app/components/ui/button";

export function AddAccountButton() {
  return (
    <Button href="/whatsapp/cuentas?nueva=1" icon={Plus} size="sm">
      Agregar número
    </Button>
  );
}
