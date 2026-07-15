const GRAPH_API = "https://graph.facebook.com/v21.0";

export interface TemplateAnalyticsPoint {
  date: string; // ISO date, start of the UTC day this point covers
  sent: number;
  delivered: number;
  read: number;
  clicked: number;
}

interface MetaClickDetail {
  button_content?: string;
  type?: string;
  count?: number;
}

interface MetaDataPoint {
  template_id: string;
  start: number;
  end: number;
  sent?: number;
  delivered?: number;
  read?: number;
  clicked?: MetaClickDetail[];
}

interface TemplateAnalyticsContainer {
  data?: Array<{ granularity: string; data_points: MetaDataPoint[] }>;
  paging?: { next?: string };
}

interface MetaTemplateAnalyticsResponse extends TemplateAnalyticsContainer {
  // The first request is a *field expansion* on the WABA node
  // (`/{waba-id}?fields=template_analytics...`), which nests the result under this
  // key. Meta's `paging.next` cursor URL, once fetched, is instead a direct hit on
  // the `template_analytics` edge itself (`/{waba-id}/template_analytics?...`) and
  // returns `data`/`paging` at the top level — no `template_analytics` wrapper.
  // Same page shape, different envelope depending on how you got there.
  template_analytics?: TemplateAnalyticsContainer;
  error?: { message?: string; error_user_msg?: string };
}

// Meta paginates data_points (default page size 25, one per day — a ~90-day range
// spans multiple pages). Follow `paging.next` until exhausted or the safety cap is
// hit, or a wide date range silently loses its most recent days (they sort last,
// so they're the ones cut off by the first unpaginated page).
const MAX_PAGES = 20;

export type TemplateAnalyticsResult =
  | { success: true; points: TemplateAnalyticsPoint[] }
  | { success: false; error: string };

// Meta's Template Analytics endpoint — a field expansion on the WABA node, not a
// dedicated REST path. metric_types/granularity/template_ids are all query params
// baked into the `fields` string itself (Graph API's field-expansion syntax), not
// regular query string params. DAILY is the only granularity template_analytics
// supports (unlike conversation_analytics, which also offers HALF_HOUR/MONTHLY).
export async function getTemplateAnalytics(
  wabaId: string,
  accessToken: string,
  templateId: string,
  startDate: Date,
  endDate: Date
): Promise<TemplateAnalyticsResult> {
  const start = Math.floor(startDate.getTime() / 1000);
  const end = Math.floor(endDate.getTime() / 1000);

  const fields =
    `template_analytics.start(${start}).end(${end}).granularity(DAILY)` +
    `.metric_types(["SENT","DELIVERED","READ","CLICKED"])` +
    `.template_ids(["${templateId}"])`;

  let url: string | undefined = `${GRAPH_API}/${wabaId}?fields=${encodeURIComponent(fields)}`;
  const dataPoints: MetaDataPoint[] = [];

  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const json = (await res.json().catch(() => ({}))) as MetaTemplateAnalyticsResponse;

    if (!res.ok) {
      const msg =
        json.error?.error_user_msg ?? json.error?.message ?? "Error al obtener métricas de Meta";
      return { success: false, error: msg };
    }

    const container = json.template_analytics ?? json;
    dataPoints.push(...(container.data?.[0]?.data_points ?? []));
    url = container.paging?.next;
  }

  const points: TemplateAnalyticsPoint[] = dataPoints
    .map((p) => ({
      date: new Date(p.start * 1000).toISOString(),
      sent: p.sent ?? 0,
      delivered: p.delivered ?? 0,
      read: p.read ?? 0,
      clicked: Array.isArray(p.clicked)
        ? p.clicked.reduce((sum, c) => sum + (c.count ?? 0), 0)
        : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { success: true, points };
}
