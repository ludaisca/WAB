"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Sparkles, RefreshCw } from "lucide-react";
import { Dropdown, DropdownButton } from "@/app/components/ui/dropdown";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { useToast } from "@/app/components/ui/toast";

interface ScoreDetails {
  tipo_lead: string | null;
  necesidad_principal: string | null;
  contexto_negocio: string | null;
  senales_compra: string[];
  objeciones_dudas: string[];
  nivel_interaccion: string | null;
  tono_interes: string | null;
  proximos_pasos: string[];
  nombre_real: string | null;
  producto_interes: string | null;
  urgencia: string | null;
  presupuesto: string | null;
}

interface LeadScore {
  id: string;
  scorerId: string;
  scorer: { id: string; name: string };
  score: number;
  // Untyped at the source (whatever the AI + parser produced) — scores from
  // before the 5-phase relabel (frio/tibio/caliente) may still carry an old
  // value, so this can't be trusted as the current label union.
  label: string;
  summary: string;
  reasons: string;
  details: ScoreDetails | null;
  updatedAt: string;
}

interface ScorerOption {
  id: string;
  name: string;
}

const LABEL_TONE: Record<string, "neutral" | "info" | "warning" | "accent" | "danger"> = {
  descartado: "neutral",
  frio: "info",
  interesado: "warning",
  oportunidad: "accent",
  prioridad_alta: "danger",
  // Legacy 3-tier labels, kept until every existing score gets re-run.
  tibio: "warning",
  caliente: "danger",
};

const LABEL_TEXT: Record<string, string> = {
  descartado: "Descartado",
  frio: "Frío",
  interesado: "Interesado",
  oportunidad: "Oportunidad",
  prioridad_alta: "Prioridad alta",
  tibio: "Tibio",
  caliente: "Caliente",
};

function labelTone(label: string) {
  return LABEL_TONE[label] ?? "neutral";
}

function labelText(label: string) {
  return LABEL_TEXT[label] ?? label;
}

export function LeadScoreBadge({ chatId }: { chatId: string }) {
  const { error: toastError } = useToast();
  const [open, setOpen] = useState(false);
  const [scores, setScores] = useState<LeadScore[]>([]);
  const [selectedScoreId, setSelectedScoreId] = useState<string | null>(null);
  const [scorers, setScorers] = useState<ScorerOption[]>([]);
  const [scorerId, setScorerId] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchScores = useCallback(async () => {
    try {
      const res = await fetch(`/api/whatsapp/chats/${chatId}/score`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setScores(data);
        setSelectedScoreId((prev) => (data.some((s) => s.id === prev) ? prev : data[0]?.id ?? null));
      }
    } catch {
      // silent — score is best-effort context, not critical path
    }
  }, [chatId]);

  const fetchScorers = useCallback(async () => {
    try {
      const res = await fetch(`/api/whatsapp/chats/${chatId}/scorers`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setScorers(data);
        setScorerId((prev) => (data.some((s: ScorerOption) => s.id === prev) ? prev : data[0]?.id ?? ""));
      }
    } catch {
      // silent — populated lazily, button just stays disabled if it fails
    }
  }, [chatId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on chat change
    fetchScores();
    fetchScorers();
  }, [fetchScores, fetchScorers]);

  async function handleScore() {
    if (!scorerId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/chats/${chatId}/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scorerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al calificar el lead");
      setScores((prev) => {
        const next = prev.filter((s) => s.scorerId !== data.scorerId);
        return [data, ...next];
      });
      setSelectedScoreId(data.id);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Error al calificar el lead");
    } finally {
      setLoading(false);
    }
  }

  const selectedScore = scores.find((s) => s.id === selectedScoreId) ?? scores[0] ?? null;

  let reasons: string[] = [];
  try {
    reasons = selectedScore ? JSON.parse(selectedScore.reasons) : [];
  } catch {
    reasons = [];
  }

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      align="right"
      trigger={
        selectedScore ? (
          <DropdownButton
            label={`${labelText(selectedScore.label)} · ${selectedScore.score}`}
            icon={Sparkles}
            size="sm"
          />
        ) : (
          <DropdownButton label="Calificar lead" icon={Sparkles} size="sm" />
        )
      }
    >
      <div className="p-3 w-80 space-y-3 max-h-[70vh] overflow-y-auto">
        {scorers.length === 0 ? (
          <p className="text-sm text-muted">
            Aún no tienes calificadores creados.{" "}
            <Link href="/whatsapp/calificadores" className="text-accent hover:underline">
              Crea uno aquí
            </Link>
            .
          </p>
        ) : (
          <>
            {scores.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {scores.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedScoreId(s.id)}
                    className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                      s.id === selectedScoreId
                        ? "border-accent text-accent bg-accent/10"
                        : "border-border text-muted-darker hover:text-foreground"
                    }`}
                  >
                    {s.scorer.name}
                  </button>
                ))}
              </div>
            )}

            {selectedScore ? (
              <>
                <div className="flex items-center justify-between">
                  <Badge tone={labelTone(selectedScore.label)}>{labelText(selectedScore.label)} · {selectedScore.score}/100</Badge>
                  <span className="text-[11px] text-muted-darker">
                    {new Date(selectedScore.updatedAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </div>
                <p className="text-[11px] text-muted-darker">Calificado por: {selectedScore.scorer.name}</p>
                <p className="text-sm text-foreground">{selectedScore.summary}</p>
                {reasons.length > 0 && (
                  <ul className="text-xs text-muted list-disc pl-4 space-y-0.5">
                    {reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
                {selectedScore.details && (
                  <div className="space-y-2 pt-1 border-t border-border">
                    {(selectedScore.details.producto_interes || selectedScore.details.urgencia) && (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedScore.details.producto_interes && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent/10 text-accent">
                            {selectedScore.details.producto_interes}
                          </span>
                        )}
                        {selectedScore.details.urgencia && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-warning-bg text-warning">
                            Urgencia: {selectedScore.details.urgencia}
                          </span>
                        )}
                      </div>
                    )}
                    {selectedScore.details.senales_compra.length > 0 && (
                      <div>
                        <p className="text-[11px] font-medium text-success">Señales de compra</p>
                        <ul className="text-xs text-muted-darker list-disc pl-4">
                          {selectedScore.details.senales_compra.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {selectedScore.details.objeciones_dudas.length > 0 && (
                      <div>
                        <p className="text-[11px] font-medium text-danger">Objeciones / dudas</p>
                        <ul className="text-xs text-muted-darker list-disc pl-4">
                          {selectedScore.details.objeciones_dudas.map((o, i) => <li key={i}>{o}</li>)}
                        </ul>
                      </div>
                    )}
                    {selectedScore.details.proximos_pasos.length > 0 && (
                      <div>
                        <p className="text-[11px] font-medium text-accent">Próximos pasos sugeridos</p>
                        <ul className="text-xs text-muted-darker list-disc pl-4">
                          {selectedScore.details.proximos_pasos.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted">Aún no se ha calificado esta conversación.</p>
            )}

            <div className="space-y-1.5 pt-1 border-t border-border">
              <Select value={scorerId} onChange={(e) => setScorerId(e.target.value)}>
                {scorers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="secondary"
                icon={loading ? RefreshCw : Sparkles}
                onClick={handleScore}
                disabled={loading || !scorerId}
                className="w-full"
              >
                {loading ? "Calificando..." : "Calificar con este agente"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dropdown>
  );
}
