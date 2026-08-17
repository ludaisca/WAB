import { prisma } from "@/lib/prisma";
import { fetchMessageCounts, fetchDailyMessageTrend, type DailyMessageRow } from "./messages";
import { fetchBotCostRows, fetchAiCostSummary, type BotCostRow } from "./ai-usage";
import { runSystemDiagnostics } from "@/lib/whatsapp/system-diagnostics";
import { dateKeyInTz } from "@/lib/timezone";
import type { ScoreDetails } from "@/lib/whatsapp/export-columns";

// Fases "reales" del embudo de calificación IA — excluye "descartado" (no es
// un lead, es basura filtrada) tanto de la tendencia diaria (máx. 4 series,
// ver app/components/ui/chart.tsx:MAX_SERIES) como de la base del embudo/tasa
// de conversión.
const QUALIFIED_TREND_LABELS = ["frio", "interesado", "oportunidad", "prioridad_alta"] as const;
type QualifiedTrendLabel = (typeof QUALIFIED_TREND_LABELS)[number];

// Tope de la lista de "hallazgos más frecuentes" por campo.
const TOP_FINDINGS_N = 5;

// top-N por frecuencia, agrupando por texto normalizado (trim + minúsculas)
// pero mostrando la primera variante de capitalización vista — evita que
// "Precio" y "precio" cuenten como hallazgos distintos sin un fuzzy-match más
// agresivo.
function topByFrequency(values: Iterable<string | null | undefined>): Array<{ value: string; count: number }> {
  const counts = new Map<string, { display: string; count: number }>();
  for (const raw of values) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { display: trimmed, count: 1 });
  }
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_FINDINGS_N)
    .map(({ display, count }) => ({ value: display, count }));
}

// Todas las queries de este archivo son agregados puros (count/groupBy/
// aggregate) — a propósito, NO reutilizan los builders de fila completa de
// lib/google/dataset-queries.ts (buildChatRows/buildLeadScoreRows/etc, los
// que sí usa lib/reports/build-workbook.ts para el .xlsx). Esos builders
// traen CHAT_ATTRIBUTION_MESSAGE_QUERY (relación anidada con filtros de
// negación `not: null`) que reventó el límite de parámetros de Postgres con
// muchos chats sin acotar (ver date-range.ts:widenedDateStrings) — un
// agregado nunca arma esa relación por fila, así que es seguro y rápido sin
// el margen de ±1 día, con gte/lt exactos.

export interface DashboardKpis {
  messagesTotal: number;
  messagesInbound: number;
  messagesOutbound: number;
  chatsActive: number;
  contactsNew: number;
  aiCost: number;
  aiTokens: number;
  leadsQualified: number;
}

export interface DashboardDiagnosticsSummary {
  issuesFound: number;
  high: number;
  medium: number;
}

export interface ReportDashboardData {
  kpis: DashboardKpis;
  dailyMessages: DailyMessageRow[];
  // true cuando la muestra de dailyMessages se truncó (rango con más de
  // TREND_SAMPLE_LIMIT mensajes, ver messages.ts:fetchDailyMessageTrend) — la
  // gráfica solo cubre los días más recientes, no el rango completo elegido.
  dailyMessagesTruncated: boolean;
  leadsByLabel: Array<{ label: string; count: number }>;
  campaignFunnel: { sent: number; delivered: number; read: number; failed: number };
  botCostRows: BotCostRow[];
  diagnostics: DashboardDiagnosticsSummary;
  // Los 3 agregados de abajo cuentan EVALUACIONES (WALeadScore.updatedAt en
  // el rango), no chats únicos — mismo criterio que leadsByLabel/leadsQualified
  // arriba (y que "Leads calificados — {label}" en la hoja Resumen del .xlsx):
  // un chat recalificado dos veces en el rango cuenta dos veces.
  qualifiedAvgScore: number | null;
  // % de leads reales (excluyendo "descartado") que llegan a "oportunidad" o más.
  qualifiedConversionRate: number | null;
  qualificationFunnel: Array<{ name: string; value: number }>;
  qualificationTrend: Array<{ date: string } & Record<QualifiedTrendLabel, number>>;
  // Campos cualitativos de WALeadScore.details (producto_interes,
  // objeciones_dudas, senales_compra, urgencia) agregados top-5 por
  // frecuencia — hasta ahora solo se veían evaluación por evaluación en la
  // hoja "Leads calificados" del .xlsx.
  leadFindings: {
    topProductos: Array<{ value: string; count: number }>;
    topObjeciones: Array<{ value: string; count: number }>;
    topSenales: Array<{ value: string; count: number }>;
    topUrgencia: Array<{ value: string; count: number }>;
  };
}

// Mismo mapeo que el LEAD_SHEET_STATUS_MAP privado de
// lib/google/dataset-queries.ts (no exportado) — duplicado aquí a propósito,
// es 4 líneas y evita acoplar este módulo al interno de otro.
const AUTOMATION_STATUS_KEY: Record<string, "sent" | "delivered" | "read" | "failed"> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

// WACampaignRecipient.status (y LeadSheetImportedRow.status para envíos de
// automatización) es un estado ACTUAL excluyente que WhatsApp sobreescribe
// solo hacia adelante (SENT→DELIVERED→READ, ver applyStatusUpdate() en
// app/api/whatsapp/webhook/route.ts) — no una fila por etapa alcanzada. Un
// groupBy(status) ingenuo suma cada bucket como si ya fuera el total de esa
// etapa, lo que subcuenta "sent"/"delivered" (excluye a quienes ya avanzaron
// a la siguiente) y puede mostrar leídos > enviados (>100% en el embudo).
// Mismo criterio acumulativo que ya usa syncCampaignCounts() en el webhook
// para WACampaign.deliveredCount/readCount — "entregado" cuenta también a
// quien ya llegó a "leído", y "enviado" cuenta a quien llegó a cualquiera de
// las 3 etapas siguientes.
function addCumulativeFunnel(
  funnel: { sent: number; delivered: number; read: number; failed: number },
  counts: { sent: number; delivered: number; read: number; failed: number }
): void {
  funnel.sent += counts.sent + counts.delivered + counts.read;
  funnel.delivered += counts.delivered + counts.read;
  funnel.read += counts.read;
  funnel.failed += counts.failed;
}

export async function getReportDashboard(
  accountIds: string[],
  userId: string,
  gte: Date,
  lt: Date
): Promise<ReportDashboardData> {
  const [
    messageCounts,
    dailyMessagesResult,
    chatsActive,
    contactsNew,
    leadScores,
    manualStatusGroups,
    automationStatusGroups,
    botCostRows,
    aiCostSummary,
    diagnostics,
  ] = await Promise.all([
    fetchMessageCounts(accountIds, gte, lt),
    fetchDailyMessageTrend(accountIds, gte, lt),
    prisma.wAChat.count({ where: { accountId: { in: accountIds }, lastMessageAt: { gte, lt } } }),
    prisma.contact.count({ where: { accountId: { in: accountIds }, createdAt: { gte, lt } } }),
    // findMany (no groupBy): además del conteo por label necesitamos score +
    // details por fila para avgScore/conversionRate/leadFindings, y updatedAt
    // para el bucketing diario de qualificationTrend.
    prisma.wALeadScore.findMany({
      where: { chat: { accountId: { in: accountIds } }, updatedAt: { gte, lt } },
      select: { score: true, label: true, details: true, updatedAt: true },
    }),
    prisma.wACampaignRecipient.groupBy({
      by: ["status"],
      where: { campaign: { waAccountId: { in: accountIds } }, sentAt: { gte, lt } },
      _count: { _all: true },
    }),
    prisma.leadSheetImportedRow.groupBy({
      by: ["status"],
      where: { source: { waAccountId: { in: accountIds } }, status: { not: "seeded" }, importedAt: { gte, lt } },
      _count: { _all: true },
    }),
    fetchBotCostRows(userId, gte, lt),
    fetchAiCostSummary(userId, gte, lt),
    runSystemDiagnostics(userId),
  ]);
  const { rows: dailyMessages, truncated: dailyMessagesTruncated } = dailyMessagesResult;

  const labelCounts = new Map<string, number>();
  let scoreSum = 0;
  for (const s of leadScores) {
    labelCounts.set(s.label, (labelCounts.get(s.label) ?? 0) + 1);
    scoreSum += s.score;
  }
  const leadsByLabel = Array.from(labelCounts.entries()).map(([label, count]) => ({ label, count }));
  const leadsQualified = leadScores.length;

  const descartadoCount = labelCounts.get("descartado") ?? 0;
  const oportunidadOMas = (labelCounts.get("oportunidad") ?? 0) + (labelCounts.get("prioridad_alta") ?? 0);
  const realLeads = leadsQualified - descartadoCount;

  const qualifiedAvgScore = leadsQualified > 0 ? Math.round((scoreSum / leadsQualified) * 10) / 10 : null;
  const qualifiedConversionRate = realLeads > 0 ? Math.round((oportunidadOMas / realLeads) * 1000) / 10 : null;

  // Base = realLeads (excluye "descartado") — cada paso siguiente es un
  // subconjunto del anterior, así que FunnelBars (barras decrecientes % del
  // primer paso) lee bien la profundidad de compromiso.
  const qualificationFunnel = [
    { name: "Calificados", value: realLeads },
    { name: "Interesado o más", value: (labelCounts.get("interesado") ?? 0) + oportunidadOMas },
    { name: "Oportunidad o más", value: oportunidadOMas },
    { name: "Prioridad alta", value: labelCounts.get("prioridad_alta") ?? 0 },
  ];

  const leadFindings = {
    topProductos: topByFrequency(leadScores.map((s) => (s.details as ScoreDetails | null)?.producto_interes)),
    topObjeciones: topByFrequency(leadScores.flatMap((s) => (s.details as ScoreDetails | null)?.objeciones_dudas ?? [])),
    topSenales: topByFrequency(leadScores.flatMap((s) => (s.details as ScoreDetails | null)?.senales_compra ?? [])),
    topUrgencia: topByFrequency(leadScores.map((s) => (s.details as ScoreDetails | null)?.urgencia)),
  };

  // Bucketing diario (CDMX) dentro del rango elegido — a diferencia de
  // Estadísticas (ventana fija de 14 días) aquí el rango es el que el admin
  // eligió, potencialmente semanas o meses. "descartado" y labels legacy
  // (tibio/caliente) quedan fuera, ver QUALIFIED_TREND_LABELS.
  const trendMap = new Map<string, Record<QualifiedTrendLabel, number>>();
  for (const s of leadScores) {
    if (!QUALIFIED_TREND_LABELS.includes(s.label as QualifiedTrendLabel)) continue;
    const date = dateKeyInTz(s.updatedAt);
    const entry = trendMap.get(date) ?? { frio: 0, interesado: 0, oportunidad: 0, prioridad_alta: 0 };
    entry[s.label as QualifiedTrendLabel]++;
    trendMap.set(date, entry);
  }
  const qualificationTrend = Array.from(trendMap.entries())
    .map(([date, counts]) => ({ date, ...counts }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const manualCounts = { sent: 0, delivered: 0, read: 0, failed: 0 };
  for (const g of manualStatusGroups) {
    const count = g._count._all;
    if (g.status === "SENT") manualCounts.sent += count;
    else if (g.status === "DELIVERED") manualCounts.delivered += count;
    else if (g.status === "READ") manualCounts.read += count;
    else if (g.status === "FAILED") manualCounts.failed += count;
  }
  const automationCounts = { sent: 0, delivered: 0, read: 0, failed: 0 };
  for (const g of automationStatusGroups) {
    const key = AUTOMATION_STATUS_KEY[g.status];
    if (key) automationCounts[key] += g._count._all;
  }
  const campaignFunnel = { sent: 0, delivered: 0, read: 0, failed: 0 };
  addCumulativeFunnel(campaignFunnel, manualCounts);
  addCumulativeFunnel(campaignFunnel, automationCounts);

  const high = diagnostics.issues.filter((i) => i.severity === "alta").length;
  const medium = diagnostics.issues.filter((i) => i.severity === "media").length;

  return {
    kpis: {
      messagesTotal: messageCounts.total,
      messagesInbound: messageCounts.inbound,
      messagesOutbound: messageCounts.outbound,
      chatsActive,
      contactsNew,
      aiCost: aiCostSummary.totalCost,
      aiTokens: aiCostSummary.totalTokens,
      leadsQualified,
    },
    dailyMessages,
    dailyMessagesTruncated,
    leadsByLabel,
    campaignFunnel,
    botCostRows: botCostRows.filter((b) => b.interactions > 0).slice(0, 5),
    diagnostics: { issuesFound: diagnostics.issuesFound, high, medium },
    qualifiedAvgScore,
    qualifiedConversionRate,
    qualificationFunnel,
    qualificationTrend,
    leadFindings,
  };
}
