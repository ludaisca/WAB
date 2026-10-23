import assert from "node:assert/strict";
import { test, beforeEach, afterEach, mock } from "node:test";
import load from "./helpers/load-typescript.mjs";

const { containsInternalBotContent, SAFE_BOT_REPLY } = load("lib/whatsapp/bot-tools/reply-safety.ts");
const { completeWithBotTools } = load("lib/whatsapp/bot-tools/run-tool-loop.ts");
const { buildQualifiedDataTool } = load("lib/whatsapp/bot-tools/qualified-data.ts");
const { createGoogleClient } = load("lib/ai/providers/google.ts");

// Ninguna prueba puede consultar Google, APIs de precios o Meta de verdad.
beforeEach(() => mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network request"); }));
afterEach(() => mock.restoreAll());

const leaked = "tool_code\nprint(default_api.registrar_dato_prospecto(clave='nombre', valor='Ana'))\nthought\nThe user provided their name.¡Hola, Ana!";
const call = (key = "nombre", value = "Ana") => ({ id: `register_${key}`, name: "registrar_dato_prospecto", arguments: { clave: key, valor: value }, thoughtSignature: "opaque-signature" });
const params = (tools) => ({ model: "mock", messages: [{ role: "user", content: "Ana" }], tools });

function sequence(responses) {
  const requests = [];
  return {
    requests,
    async complete(request) {
      requests.push(structuredClone(request));
      assert.ok(responses.length, "El bucle excedió las llamadas esperadas");
      return responses.shift();
    },
  };
}

test("detecta formatos internos observados y conserva respuestas normales", () => {
  for (const text of [leaked, "<function_calls><tool_code>register()</tool_code></function_calls>", "```python\nprint(default_api.registrar_dato_prospecto())\n```", "thought\nInternal text", "<think>internal</think>Hola", "<analysis>internal</analysis>", "¿Debo llamar registrar_dato_prospecto?", "analysis: internal", "[thought] internal"]) {
    assert.equal(containsInternalBotContent(text), true, text);
  }
  for (const text of ["¡Hola, Ana! ¿Qué equipo te interesa?", "El equipo permite análisis clínicos.", "¿Ya te registraste al evento?", "El Doppler incluye análisis de flujo."]) {
    assert.equal(containsInternalBotContent(text), false, text);
  }
});

test("repara la llamada escrita como texto, ejecuta la herramienta real y conserva uso", async () => {
  const data = {};
  const tool = buildQualifiedDataTool(data);
  const client = sequence([
    { content: leaked, usage: { promptTokens: 10, completionTokens: 20 } },
    { content: "", toolCalls: [call()], usage: { promptTokens: 30, completionTokens: 40 } },
    { content: "¡Hola, Ana! ¿Qué equipo te interesa?", usage: { promptTokens: 50, completionTokens: 60 } },
  ]);
  const result = await completeWithBotTools(client, params([tool]));
  assert.equal(result.content, "¡Hola, Ana! ¿Qué equipo te interesa?");
  assert.deepEqual(data, { nombre: "Ana" });
  assert.equal(result.toolCallLog.length, 1);
  assert.deepEqual(result.totalUsage, { promptTokens: 90, completionTokens: 120 });
  assert.equal(client.requests[1].toolChoice, "auto");
  assert.ok(client.requests[1].messages.some(m => m.role === "system"));
  assert.ok(!JSON.stringify(client.requests).includes(leaked));
  const replay = client.requests[2].messages.find(m => m.toolCalls);
  assert.equal(replay.toolCalls[0].thoughtSignature, "opaque-signature");
});

test("no ejecuta código textual y responde con fallback tras una sola reparación fallida", async () => {
  const data = {};
  const client = sequence([{ content: leaked }, { content: leaked }]);
  const result = await completeWithBotTools(client, params([buildQualifiedDataTool(data)]));
  assert.equal(result.content, SAFE_BOT_REPLY);
  assert.deepEqual(data, {});
  assert.deepEqual(result.toolCallLog, []);
  assert.equal(client.requests.length, 2);
});

test("descarta texto intermedio y no repite herramientas exitosas al reparar", async () => {
  const data = {};
  const client = sequence([
    { content: leaked, toolCalls: [call()] },
    { content: "thought\nInternal text" },
    { content: "¡Hola, Ana!" },
  ]);
  const result = await completeWithBotTools(client, params([buildQualifiedDataTool(data)]));
  assert.equal(result.content, "¡Hola, Ana!");
  assert.deepEqual(data, { nombre: "Ana" });
  assert.equal(result.toolCallLog.length, 1);
  assert.equal(client.requests[1].messages.find(m => m.toolCalls).content, "");
});

test("fuerza NONE tras tres rondas de herramientas y mantiene un máximo de cinco peticiones", async () => {
  const data = {};
  const client = sequence([
    { content: "", toolCalls: [call("nombre", "Ana")] },
    { content: "", toolCalls: [call("ciudad", "CDMX")] },
    { content: "", toolCalls: [call("interes", "ultrasonido")] },
    { content: leaked },
    // Un proveedor que ignora NONE tampoco puede extender el bucle ni ejecutar.
    { content: "", toolCalls: [call("no_ejecutar", "x")] },
  ]);
  const result = await completeWithBotTools(client, params([buildQualifiedDataTool(data)]));
  assert.equal(result.content, SAFE_BOT_REPLY);
  assert.equal(client.requests.length, 5);
  assert.equal(client.requests[3].toolChoice, "none");
  assert.equal(client.requests[4].toolChoice, "none");
  assert.equal(client.requests[3].tools.length, 1);
  assert.deepEqual(data, { nombre: "Ana", ciudad: "CDMX", interes: "ultrasonido" });
});

test("repara respuestas vacías y funciona sin herramientas", async () => {
  const client = sequence([{ content: " " }, { content: "¡Hola!" }]);
  const result = await completeWithBotTools(client, params([]));
  assert.equal(result.content, "¡Hola!");
  assert.equal(client.requests.length, 2);
  assert.equal(client.requests[1].tools, undefined);
});

function mockGoogle(t, parts, extra = {}) {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
      ...extra,
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  return requests;
}

test("Google devuelve solo texto público, sin thoughts ni código ejecutable", async (t) => {
  mockGoogle(t, [
    { text: "Private model text", thought: true },
    { executableCode: { language: "PYTHON", code: "print('private')" } },
    { codeExecutionResult: { outcome: "OUTCOME_OK", output: "private" } },
    { text: "¡Hola, " }, { text: "Ana!", thoughtSignature: "text-signature" },
  ]);
  const result = await createGoogleClient("fake").complete(params([]));
  assert.equal(result.content, "¡Hola, Ana!");
  assert.deepEqual(result.usage, { promptTokens: 10, completionTokens: 20 });
});

test("Google conserva llamadas estructuradas y sus firmas; NONE llega al API", async (t) => {
  const requests = mockGoogle(t, [
    { text: "Private", thought: true },
    { functionCall: { name: "registrar_dato_prospecto", args: { clave: "nombre", valor: "Ana" } }, thoughtSignature: "signed-call" },
  ]);
  const tool = buildQualifiedDataTool({});
  const result = await createGoogleClient("fake").complete({ ...params([]), tools: [tool.definition], toolChoice: "none" });
  assert.equal(result.content, "");
  assert.equal(result.toolCalls[0].thoughtSignature, "signed-call");
  assert.deepEqual(result.toolCalls[0].arguments, { clave: "nombre", valor: "Ana" });
  assert.equal(requests[0].toolConfig.functionCallingConfig.mode, "NONE");
});

test("Google mantiene el tratamiento de contenido bloqueado", async (t) => {
  mockGoogle(t, [], { candidates: [], promptFeedback: { blockReason: "SAFETY" } });
  const result = await createGoogleClient("fake").complete(params([]));
  assert.equal(result.content, "");
  assert.equal(result.toolCalls, undefined);
});

test("reparación completa con el SDK de Google: texto inválido, functionCall real y respuesta pública", async (t) => {
  const requests = [];
  const responses = [
    [{ text: leaked }],
    [{ text: "Internal text", thought: true }, { functionCall: { name: "registrar_dato_prospecto", args: { clave: "nombre", valor: "Ana" } }, thoughtSignature: "signed-call" }],
    [{ text: "¡Hola, Ana!" }],
  ];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    requests.push(JSON.parse(options.body));
    assert.ok(responses.length);
    return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: responses.shift() }, finishReason: "STOP" }] }), { status: 200 });
  });
  const data = {};
  const result = await completeWithBotTools(createGoogleClient("fake"), params([buildQualifiedDataTool(data)]));
  assert.equal(result.content, "¡Hola, Ana!");
  assert.deepEqual(data, { nombre: "Ana" });
  assert.equal(requests.length, 3);
  assert.ok(!JSON.stringify(requests).includes(leaked));
  const replay = requests[2].contents.flatMap(content => content.parts).find(part => part.functionCall);
  assert.equal(replay.thoughtSignature, "signed-call");
  assert.ok(requests[2].contents.some(content => content.parts.some(part => part.functionResponse)));
});

function generator(client, rag = async () => null) {
  return load("lib/whatsapp/bot-tools/generate-reply.ts", {
    "@/lib/ai/factory": { getAIProvider: () => client },
    "@/lib/ai/rag": { searchKnowledge: rag },
  }).generateBotReply;
}
const bot = { id: "test-bot", name: "Test", systemPrompt: "Asesora sobre equipo médico.", model: "mock", temperature: 0.7, maxTokens: 1024, ragEnabled: false, priceLookupEnabled: false };

test("el turno completo devuelve los datos registrados y excluye historial contaminado de prompt y RAG", async () => {
  let ragQuery;
  const client = sequence([
    { content: leaked },
    { content: "", toolCalls: [call()] },
    { content: "¡Hola, Ana! ¿Qué equipo te interesa?" },
  ]);
  const generate = generator(client, async (_id, query) => { ragQuery = query; return null; });
  const history = [{ role: "user", content: "Hola" }, { role: "assistant", content: leaked }, { role: "assistant", content: "¿Con quién tengo el gusto?" }];
  const result = await generate({ bot: { ...bot, ragEnabled: true }, apiKey: "fake", ragQuery: "Ana", userContent: "Ana", history, qualifiedData: { ciudad: "CDMX" } });
  assert.equal(result.content, "¡Hola, Ana! ¿Qué equipo te interesa?");
  assert.deepEqual(result.qualifiedData, { ciudad: "CDMX", nombre: "Ana" });
  assert.ok(!ragQuery.includes(leaked));
  assert.ok(!JSON.stringify(client.requests).includes(leaked));
  assert.equal(history[1].content, leaked, "No se modifica el historial original");
});

test("la respuesta segura llega intacta al envío normal o dividido", async () => {
  const client = sequence([{ content: leaked }, { content: leaked }]);
  const result = await generator(client)({ bot, apiKey: "fake", ragQuery: "Ana", userContent: "Ana", history: [] });
  assert.equal(result.content, SAFE_BOT_REPLY);
  const { splitReply } = load("lib/whatsapp/humanize.ts");
  assert.deepEqual(splitReply(result.content), [SAFE_BOT_REPLY]);
  assert.deepEqual(result.qualifiedData, {});
});

test("los controles de precios y enlaces siguen activos después de la reparación", async () => {
  for (const text of ["Cuesta $15000.", "Consulta https://inventado.invalid/datos"]) {
    const client = sequence([{ content: leaked }, { content: text }]);
    const result = await generator(client)({ bot, apiKey: "fake", ragQuery: "precio", userContent: "precio", history: [] });
    assert.notEqual(result.content, text);
    assert.ok(!result.content.includes("15000"));
    assert.ok(!result.content.includes("inventado.invalid"));
  }
});
