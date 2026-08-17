export type ReportStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface ReportItem {
  id: string;
  status: ReportStatus;
  rangeFrom: string;
  rangeTo: string;
  filename: string | null;
  sizeBytes: number | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  createdBy: { id: string; name: string | null; email: string } | null;
}

export interface ReportDashboardData {
  kpis: {
    messagesTotal: number;
    messagesInbound: number;
    messagesOutbound: number;
    chatsActive: number;
    contactsNew: number;
    aiCost: number;
    aiTokens: number;
    leadsQualified: number;
  };
  dailyMessages: Array<{ date: string; inbound: number; outbound: number; total: number }>;
  // true si la gráfica no alcanzó a cubrir el rango completo elegido (más de
  // 5,000 mensajes en el rango) — ver lib/reports/queries/messages.ts.
  dailyMessagesTruncated: boolean;
  leadsByLabel: Array<{ label: string; count: number }>;
  campaignFunnel: { sent: number; delivered: number; read: number; failed: number };
  botCostRows: Array<{
    id: string;
    name: string;
    status: string;
    isActive: boolean;
    interactions: number;
    totalTokens: number;
    totalCost: number;
  }>;
  diagnostics: { issuesFound: number; high: number; medium: number };
  qualifiedAvgScore: number | null;
  qualifiedConversionRate: number | null;
  qualificationFunnel: Array<{ name: string; value: number }>;
  qualificationTrend: Array<{ date: string; frio: number; interesado: number; oportunidad: number; prioridad_alta: number }>;
  leadFindings: {
    topProductos: Array<{ value: string; count: number }>;
    topObjeciones: Array<{ value: string; count: number }>;
    topSenales: Array<{ value: string; count: number }>;
    topUrgencia: Array<{ value: string; count: number }>;
  };
}
