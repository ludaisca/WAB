"use client";

import { useState } from "react";
import { Card } from "./card";
import { Banner } from "./banner";
import { Button } from "./button";
import { Badge } from "./badge";

export interface AgentActionCardData {
  id: string;
  toolName: string;
  description: string;
  status: "PENDING" | "EXECUTED" | "REJECTED" | "EXPIRED" | "FAILED";
  errorMessage?: string | null;
}

const STATUS_BADGE: Record<AgentActionCardData["status"], { tone: "accent" | "success" | "neutral" | "warning" | "danger"; label: string }> = {
  PENDING: { tone: "accent", label: "Pendiente" },
  EXECUTED: { tone: "success", label: "Ejecutada" },
  REJECTED: { tone: "neutral", label: "Rechazada" },
  EXPIRED: { tone: "warning", label: "Expirada" },
  FAILED: { tone: "danger", label: "Falló" },
};

export function AgentActionCard({
  action,
  onResolved,
}: {
  action: AgentActionCardData;
  onResolved: (id: string, status: AgentActionCardData["status"], errorMessage?: string) => void;
}) {
  const [loading, setLoading] = useState<"confirm" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const badge = STATUS_BADGE[action.status];

  async function resolve(kind: "confirm" | "reject") {
    setLoading(kind);
    setError(null);
    try {
      const res = await fetch(`/api/agent/actions/${action.id}/${kind}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al procesar la acción");
      onResolved(action.id, kind === "confirm" ? "EXECUTED" : "REJECTED");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al procesar la acción");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex justify-start">
      <Card padding="sm" className="max-w-[85%] w-full">
        <Banner tone={action.status === "PENDING" ? "warning" : "neutral"} title={`Acción propuesta: ${action.toolName}`}>
          <p>{action.description}</p>
          {action.errorMessage && <p className="mt-1 text-danger">{action.errorMessage}</p>}
          {error && <p className="mt-1 text-danger">{error}</p>}
        </Banner>
        <div className="mt-3 flex items-center justify-between gap-3">
          <Badge tone={badge.tone}>{badge.label}</Badge>
          {action.status === "PENDING" && (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => resolve("reject")} loading={loading === "reject"} disabled={loading !== null}>
                Rechazar
              </Button>
              <Button variant="primary" size="sm" onClick={() => resolve("confirm")} loading={loading === "confirm"} disabled={loading !== null}>
                Confirmar
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
