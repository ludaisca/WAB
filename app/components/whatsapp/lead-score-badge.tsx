"use client";

import { useState, useEffect, useCallback } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import { Dropdown, DropdownButton } from "@/app/components/ui/dropdown";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";

interface LeadScore {
  id: string;
  score: number;
  label: "frio" | "tibio" | "caliente";
  summary: string;
  reasons: string;
  updatedAt: string;
}

const LABEL_TONE: Record<LeadScore["label"], "info" | "warning" | "danger"> = {
  frio: "info",
  tibio: "warning",
  caliente: "danger",
};

const LABEL_TEXT: Record<LeadScore["label"], string> = {
  frio: "Frío",
  tibio: "Tibio",
  caliente: "Caliente",
};

export function LeadScoreBadge({ chatId }: { chatId: string }) {
  const { error: toastError } = useToast();
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState<LeadScore | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchScore = useCallback(async () => {
    try {
      const res = await fetch(`/api/whatsapp/chats/${chatId}/score`);
      const data = await res.json();
      setScore(data ?? null);
    } catch {
      // silent — score is best-effort context, not critical path
    }
  }, [chatId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on chat change
    fetchScore();
  }, [fetchScore]);

  async function handleScore() {
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/chats/${chatId}/score`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al calificar el lead");
      setScore(data);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al calificar el lead");
    } finally {
      setLoading(false);
    }
  }

  let reasons: string[] = [];
  try {
    reasons = score ? JSON.parse(score.reasons) : [];
  } catch {
    reasons = [];
  }

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      align="right"
      trigger={
        score ? (
          <DropdownButton
            label={`${LABEL_TEXT[score.label]} · ${score.score}`}
            icon={Sparkles}
            size="sm"
          />
        ) : (
          <DropdownButton label="Calificar lead" icon={Sparkles} size="sm" />
        )
      }
    >
      <div className="p-3 w-72 space-y-3">
        {score ? (
          <>
            <div className="flex items-center justify-between">
              <Badge tone={LABEL_TONE[score.label]}>{LABEL_TEXT[score.label]} · {score.score}/100</Badge>
              <span className="text-[11px] text-muted-darker">
                {new Date(score.updatedAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
              </span>
            </div>
            <p className="text-sm text-foreground">{score.summary}</p>
            {reasons.length > 0 && (
              <ul className="text-xs text-muted list-disc pl-4 space-y-0.5">
                {reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">Aún no se ha calificado esta conversación.</p>
        )}
        <Button
          size="sm"
          variant="secondary"
          icon={loading ? RefreshCw : Sparkles}
          onClick={handleScore}
          disabled={loading}
          className="w-full"
        >
          {loading ? "Calificando..." : score ? "Recalificar" : "Calificar lead"}
        </Button>
      </div>
    </Dropdown>
  );
}
