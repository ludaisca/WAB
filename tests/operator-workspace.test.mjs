import assert from "node:assert/strict";
import { test } from "node:test";
import load from "./helpers/load-typescript.mjs";

const { mergeChatMessages, mergeChatPages } = load("lib/whatsapp/chat-state.ts");
test("historial: conserva mensajes antiguos, actualiza entrega y deduplica un envío que llega también por polling", () => {
  const before = [{ id: "old", timestamp: "2026-10-01", body: "Historial" }, { id: "new", timestamp: "2026-10-02", status: "SENT" }];
  const incoming = [{ id: "new", timestamp: "2026-10-02", status: "DELIVERED" }, { id: "latest", timestamp: "2026-10-03" }];
  const merged = mergeChatMessages(before, incoming);
  assert.deepEqual(merged.map(m => m.id), ["old", "new", "latest"]);
  assert.equal(merged[1].status, "DELIVERED");
  assert.equal(mergeChatMessages(merged, incoming).length, 3);
  assert.equal(before[1].status, "SENT");
});
test("páginas: conserva más de cien conversaciones y deduplica movimientos entre páginas", () => {
  const rows = Array.from({length:150}, (_,i) => ({id:String(i)}));
  const result = mergeChatPages([rows.slice(0,100), rows.slice(99)]);
  assert.equal(result.length, 150);
  assert.equal(result[149].id, "149");
});

function leadRoute() {
  const calls = [];
  const scope = { accountId: { in: ["shared"] }, AND: [{ messages: { some: { campaignId: { not: null } } } }] };
  const row = { id: "score", score: 80, chat: { id: "chat", publicShareToken: "existing", contact: null } };
  const route = load("app/api/whatsapp/lead-scores/route.ts", {
    "@/lib/maintenance-guard": { withMaintenanceGuard: handler => handler },
    "@/lib/auth": { auth: async () => ({ user: { id:"user", role:"user" } }) },
    "@/lib/whatsapp/chat-visibility": { chatAccessWhere: async () => scope },
    "@/lib/prisma": { prisma: {
      wALeadScore: { count: async query => { calls.push(["count",query]); return 8001; }, findMany: async query => { calls.push(["rows",query]); return [row]; } },
      wALeadScorerBot: { findMany: async query => { calls.push(["scorers",query]); return [{id:"scorer",name:"Scorer"}]; } },
      wAAccount: { findMany: async query => { calls.push(["accounts",query]); return [{id:"shared",name:"Shared"}]; } },
    } },
    "@/lib/whatsapp/chat-attribution": { fetchChatAttributions: async () => new Map(), fetchLastInboundMessages: async () => new Map() },
    "@/lib/whatsapp/chat-public-link": { ensurePublicChatTokensForChats: async () => new Map([["chat","existing"]]), publicChatUrl: token => `/c/${token}` },
  });
  return { calls, scope, get: params => route.GET(new Request(`http://ludaisca/api/whatsapp/lead-scores?${params}`)) };
}

test("leads: página y filtros se aplican antes de consultar, conservando acceso compartido y visibilidad", async () => {
  const {get,calls,scope}=leadRoute();
  const res=await get("page=3&pageSize=25&accountId=shared&scorerId=scorer&label=frio&dateFrom=2026-10-01&dateTo=2026-10-23&options=1");
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.total,8001); assert.equal(data.items.length,1);
  const query=calls.find(([kind])=>kind==="rows")[1];
  assert.equal(query.skip,50);assert.equal(query.take,25);
  assert.deepEqual(query.where.chat.AND,[scope,{accountId:"shared"}]);
  assert.equal(query.where.scorerId,"scorer");assert.equal(query.where.label,"frio");
  assert.equal(query.where.updatedAt.gte.toISOString(),"2026-10-01T06:00:00.000Z");
  assert.equal(query.where.updatedAt.lt.toISOString(),"2026-10-24T06:00:00.000Z");
  assert.deepEqual(calls.find(([kind])=>kind==="count")[1].where,query.where);
  assert.ok(data.options.accounts.length);assert.equal(query.orderBy.at(-1).id,"asc");
});
test("leads: exportar selecciones no evita el alcance y el tamaño de página se limita a cien", async () => {
  const {get,calls,scope}=leadRoute();
  assert.equal((await get("page=1&pageSize=1000&ids=a,b")).status,200);
  const query=calls.find(([kind])=>kind==="rows")[1];
  assert.deepEqual(query.where.id,{in:["a","b"]});assert.deepEqual(query.where.chat,scope);assert.equal(query.take,100);
  assert.equal((await get(`page=1&ids=${Array.from({length:101},(_,i)=>i).join(",")}`)).status,400);
});
test("leads: rechaza fechas imposibles y rangos invertidos antes de consultar", async () => {
  const {get,calls}=leadRoute();
  for(const params of ["dateFrom=2026-02-30","dateFrom=2026-11-01&dateTo=2026-10-01","dateTo=no-es-fecha"]) assert.equal((await get(params)).status,400);
  assert.equal(calls.length,0);
});
test("contadores: conversaciones visibles, bots operativos y campañas de cuentas compartidas", async () => {
  const calls=[];
  const count=kind=>async query=>{calls.push([kind,query]);return 2;};
  const counters=load("lib/estadisticas/global-counts.ts",{"@/lib/prisma":{prisma:{wAChat:{count:count("chats")},wABot:{count:count("bots")},wACampaign:{count:count("campaigns")}}}});
  const visibility={messages:{some:{campaignId:{not:null}}}};
  await counters.countChats(["shared"],visibility);await counters.countActiveBots("user");await counters.countCampaigns(["shared"]);
  assert.deepEqual(calls[0][1].where.AND,[visibility]);
  assert.equal(calls[1][1].where.status,"ACTIVE");
  assert.deepEqual(calls[2][1].where,{waAccountId:{in:["shared"]}});
});
