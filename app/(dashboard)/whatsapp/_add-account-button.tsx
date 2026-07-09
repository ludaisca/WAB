"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/app/components/ui/button";

export function AddAccountButton() {
  return (
    <Link href="/whatsapp/cuentas/nueva">
      <Button icon={Plus} size="sm">Agregar número</Button>
    </Link>
  );
}
