# AGENTS.md

## Stack
- **Next.js 16** (App Router, Turbopack) + **Tailwind CSS v4** (CSS-based, `@theme inline`)
- **NextAuth v5** beta (Credentials + JWT only, no adapter)
- **Prisma 5** (PostgreSQL + pgvector)
- **Redis 7** + **BullMQ** (job queues for async processing)
- React 19, lucide-react, zod, bcryptjs, next-themes, openai, @google/generative-ai, ioredis
- WhatsApp **multimodal** (image/audio/video/document/sticker) inbound + outbound on Meta Cloud API — see "Media handling" below

## Development

Everything runs in Docker. Never install dependencies or databases on the host.

```bash
docker compose up --build   # dev server + postgres + redis, hot reload, port 3001
docker compose down -v      # full teardown including volumes
npx tsc --noEmit            # type check
npm run build               # production build check
npx prisma generate         # after schema changes
```

- **docker-compose.yml** is production (used by Coolify). **docker-compose.override.yml** adds dev overrides (volumes, hot reload, env_file). Docker Compose merges both locally.
- `tailwindcss` and `@tailwindcss/postcss` are in `dependencies` (not devDependencies) — required at build time even with `NODE_ENV=production`.
- `public/` must contain `.gitkeep` — Docker BuildKit fails on `COPY` of empty directories.
- Named volume `media_data` mounted at `/app/media` (in both compose files) stores downloaded WhatsApp media binaries. `MEDIA_ROOT` env var defaults to `/app/media`; helpers in `lib/whatsapp/media-store.ts` resolve paths thoroughfully. `media/.gitkeep` exists on host for git tracking.
- Production `app` service uses `expose: 5000` (no fixed host port bind). Coolify's own proxy (Traefik) routes to it via the FQDN/domain configured in the Coolify UI. Do **not** add a hardcoded `ports:` mapping back to `docker-compose.yml` — a fixed host port causes `port is already allocated` failures on redeploy if a stale container from a previous deploy attempt (or another app) still holds that port on the server.

## Architecture: roles

Three roles with different UIs and access:

| Role | Sidebar | Routes blocked (`proxy.ts`) |
|---|---|---|
| `admin` | everything: Panel, Estadísticas, Chats, Contactos, Bots IA, Calificadores, Cuentas, Plantillas, Campañas, Usuarios, Config | none |
| `user` | like admin **minus** Contactos, Bots IA, Usuarios | `USER_BLOCKED`: `/whatsapp/contactos`, `/whatsapp/bots`, `/configuracion/ia` |
| `ejecutivo` | Chats, Contactos, Config | `EXECUTIVE_BLOCKED`: `/dashboard`, `/estadisticas`, `/usuarios`, `/whatsapp/{bots,campanas,plantillas,cuentas}`, `/configuracion/ia` |

Two pages were removed in the 2026-07 nav flattening: the `/whatsapp` hub (its KPIs duplicated Panel, its account list duplicated `/whatsapp/cuentas`; the route survives only as a `redirect("/whatsapp/cuentas")` and the nav item "Cuentas WhatsApp" points straight at `/whatsapp/cuentas`) and `/whatsapp/conocimiento` (fully redundant with the knowledge tab inside `whatsapp/bots/[id]`, which remains the only knowledge UI — its role-gating rides on `/whatsapp/bots`).

`/usuarios` is **not** middleware-blocked for role `user` — it's protected by nav-hiding plus the admin-only check in every `/api/usuarios` handler (403), so the page renders but loads nothing. Follow that same defense-in-depth shape (hide nav → block route where it matters → 403 in the API) when restricting anything new.

- First registered user auto-gets `admin` via atomic `$transaction(count + create)` in `app/api/auth/register/route.ts`. **The first user is always the admin and must never lose full access** — there are exactly these 3 roles, don't add/remove any without asking.
- Route protection in `proxy.ts` (Next.js 16 middleware) — `EXECUTIVE_BLOCKED` + `USER_BLOCKED` prefix lists.
- `dashboard-shell.tsx` builds `NAV[]` conditionally via `useSession().user.role`
- `/whatsapp/calificadores` is reachable by `user` but self-restricts client-side to only the "Leads calificados" tab (`canManageScorers = role !== "user"`) — the CRUD tab isn't a separate route, so it can't be blocked in `proxy.ts`.
- **AI config is admin-only in 3 layers**: the "Inteligencia Artificial" card on `/configuracion` renders only for admin, `/configuracion/ia` is in both blocked lists, and `GET/PATCH /api/configuracion/ia` return 403 for non-admin. `GET /api/configuracion/ia/models` deliberately stays open to all roles — `bots/_form.tsx` and `calificadores/_form.tsx` need it.
- **Account sharing (`WAAccountShare`)**: admin shares a `WAAccount` with another user from the "Compartir cuenta" card on `whatsapp/cuentas/[id]` (API: `GET/POST/DELETE /api/whatsapp/accounts/[id]/share`, admin-only). Sharing grants data visibility (chats/contactos/plantillas/campañas of that account) within what the grantee's role already permits — it does not change menu permissions.
- `lib/shared-accounts.ts` exports `getUserAccountIds(userId)` — own + shared accounts. Use in any new chat/message/template route that queries by account.
- `Session.user` has `id`, `email`, `name`, `role`, `createdAt` (ISO string)

## Framework quirks

- `proxy.ts` IS the middleware — Next.js 16 convention. Not `middleware.ts`
- `params` in page/layout props is `Promise<>` — must `await` before destructuring
- Server Components **cannot** pass Lucide/React components to Client Components as props. Error: "Functions cannot be passed directly to Client Components". Fix: convert the page to `"use client"` or render icons inside the client boundary. This includes `<Button icon={SomeIcon}>` written directly inside a Server Component — extract it into a small `"use client"` wrapper (e.g. `whatsapp/_add-account-button.tsx`) instead.
- `rm -rf .next` after adding/removing routes (stale Turbopack cache causes 404s/500s). If files are owned by Docker use `docker compose exec -u root app sh -c "rm -rf .next"` then `docker compose restart app`. **After a container recreate (e.g. adding a new volume), Turbopack's server-side chunk cache may not invalidate the client chunk unless you also do a hard refresh in the browser with DevTools "Disable cache" enabled** — HMR cannot bridge that gap; the client keeps loading the stale on-disk chunk with HTTP 200 (from disk cache) instead of asking for a fresh one.
- Pages using `useSearchParams()` must be wrapped in `<Suspense>`. See `app/(auth)/login/page.tsx` for pattern.
- Media URLs in chat UI are **server-proxied**, never raw Meta URLs. Always render `<img src=\`/api/whatsapp/messages/${msg.id}/media\`>` (or `<audio>`/`<video>`/download link). The endpoint authenticates via `getUserAccountIds` and streams bytes from `/app/media`. Never expose Meta's short-lived download URLs to the browser.
- `app/components/ui/modal.tsx`'s `visible` state must be initialized from the `open` prop (`useState(open)`), not `useState(false)` — the old code only flipped `visible` true on an `open: false→true` *transition*, so a modal mounted with `open={true}` from the start (e.g. reached via a `?param=1` URL instead of a button click) never became visible. Any new "auto-open via URL" modal pattern relies on this fix already being in place.
- Tailwind's `dark:` variant does **not** track this app's own light/dark toggle — this project uses a custom token system (`.light` class override on top of dark-by-default `:root` tokens in `app/globals.css`, no `@custom-variant dark` defined), so `dark:` falls back to Tailwind v4's default `prefers-color-scheme` media query, which reads the OS setting instead. Never use `dark:` classes; use the semantic tokens (`bg-surface`, `text-foreground`, etc.) which already respond correctly to the app's toggle. Exception: components that must always render in a *fixed* palette regardless of the app's theme (e.g. `<TemplatePreview>`, which mimics WhatsApp's own light chat UI) should hardcode their colors rather than use either `dark:` or the app's tokens.

### Server Components for top-level pages

`dashboard/page.tsx` and `estadisticas/page.tsx` are Server Components: they call `await auth()` + Prisma directly instead of `fetch()`-ing their own API routes (avoids a redundant HTTP round-trip). Reuse `getUserAccountIds()`/the same `where` clauses as the equivalent API route so the data scope doesn't silently diverge between the RSC and the JSON endpoint other pages still call.

Because `<Table>` (and any component using `render: (row) => JSX`) is `"use client"`, a Server Component **cannot** build its columns inline — that hits the "functions cannot be passed to Client Components" error. The fix used here: split into `page.tsx` (Server Component, fetches data) + `_view.tsx` (`"use client"`, receives the fetched data as a plain serializable prop and owns the `<Table>`/column definitions). See `estadisticas/page.tsx` + `estadisticas/_view.tsx`.

`lib/estadisticas/get-stats.ts` (`getEstadisticas(userId)`) feeds `estadisticas/page.tsx` directly (in-memory cache, 60s TTL, keyed by `userId`). The old `app/api/estadisticas` GET route was removed (2026-07) — it had no consumers; if an external integration ever needs stats over HTTP, re-add a thin route that calls `getEstadisticas()`. Global counters (accounts/chats/messages/bots/campaigns) shared by `/dashboard`, `/whatsapp` hub and `get-stats.ts` live in `lib/estadisticas/global-counts.ts` — always extend that module instead of re-writing the count queries inline, so the shared-accounts scope can't diverge between screens. `monthlyCost` reuses `lib/ai/budget.ts:getMonthlyAiCost()` (the same function that pauses spending) — never reimplement that aggregate.

RSC pages should have a sibling `loading.tsx` with skeleton placeholders — Next.js streams this automatically while the async page fetches data.

## Database

### Schema
`prisma/schema.prisma` — 26 models. Key relationships: `User → WAAccount[]`, `User → AppSettings (1:1)`, `WABot ↔ WABotKnowledge (M:N via WABotKnowledgeBot)`, `WAAccount → WAAccountShare[] → User`, `WAChat → Contact (1:1)`, `Contact ↔ Tag (M:N via ContactTag)`, `User → WALeadScorerBot[]`, `WAChat → WALeadScore[] ← WALeadScorerBot` (one score per `(chatId, scorerId)` pair, see "Lead scoring" below), `WAChat → WALeadRecoveryAttempt[]` (see "Lead recovery" below). `WAMessage` carries all media metadata: `messageType` (`text`/`image`/`audio`/`video`/`document`/`sticker`), `caption`, `mediaId` (Meta id), `mediaUrl` (relative path under `MEDIA_ROOT`), `mimeType`, `filename`, `bytesSize` (`width`/`height`/`duration` were dropped 2026-07 — Meta's webhook never populated them). `body` is reused for both text and caption-derived text; `caption` is the dedicated caption field.

### Commands
```bash
npx prisma db push       # sync schema → DB (dev, creates columns)
npx prisma generate      # regenerate client after schema changes
prisma migrate dev        # create a migration (preferred for production changes)
```

### pgvector
PostgreSQL image is `pgvector/pgvector:pg16`. Extension enabled via `docker/init.sql`. Vector column is `vector(768)` — **both providers produce 768-dim embeddings** (OpenRouter `text-embedding-3-small` with `dimensions: 768`, Google `text-embedding-004`).

**IVFFlat index gotcha**: `docker/init.sql` only runs once, at Postgres's *first* volume init — before `prisma db push` has created `wa_bot_knowledge`, so a `CREATE INDEX` there fails silently (table doesn't exist yet) and never gets a second chance. The index is instead created by `prisma/sql/ensure-vector-index.sql`, run via `npx prisma db execute --file ... ` *after* `db push`/`migrate deploy` in both `scripts/startup.sh` (prod) and `docker-compose.override.yml` (dev command). If RAG search feels like it's doing a full table scan, check `SELECT indexname FROM pg_indexes WHERE tablename = 'wa_bot_knowledge'` for `idx_knowledge_embedding` before assuming it's a query problem.

### Raw SQL gotcha
Prisma `$queryRawUnsafe` uses actual DB column names. Fields without `@map` use the Prisma field name as-is (camelCase). Prefer Prisma query builder over raw SQL.

### Registration
Uses `prisma.$transaction()` for atomic `count() + create()` — prevents race condition where two simultaneous registrations both get `admin`.

## Redis + BullMQ

8 queues, auto-started via `instrumentation.ts`:

| Queue | Concurrency | Timeout | Trigger |
|---|---|---|---|
| `bot-messages` | 3 | 60s | `ingestInboundMessage()` detects active bot → enqueues |
| `campaign-send` | 1 | 60s | "Enviar" on campaign, **plus** a repeatable `scheduled-tick` job (`* * * * *`, every minute) that claims due `SCHEDULED` campaigns (`processScheduledCampaignsTick()`, atomic `updateMany` on status so overlapping ticks can't double-enqueue) — the worker branches on `job.name` |
| `rag-index` | 2 | 60s | User uploads knowledge document |
| `media-download` | 5 | 90s, 5 attempts | `ingestInboundMessage()` with Meta `mediaId` → downloads binary bytes async |
| `media-cleanup` | 1 | 60s | Self-scheduled: `startWorkers()` registers a repeatable job (`repeat: {pattern: "0 3 * * *"}`, daily at 3am) on boot — not triggered by user action |
| `bot-message-send` | 5 | 60s | `bot-worker.ts` when `WABot.humanizeEnabled` is on — delivers each split chunk of a "humanized" reply as its own delayed job |
| `lead-scoring` | 1 | 60s | Self-scheduled repeatable tick (`*/5 * * * *`) — scheduled scorer runs, see "Lead scoring" |
| `lead-recovery` | 1 | 60s | Self-scheduled repeatable tick (`*/15 * * * *`) — re-engages silent leads, see "Lead recovery" |

- `media-cleanup-worker.ts:processMediaCleanupJob()` deletes `WAMessage.mediaUrl` files older than `MEDIA_RETENTION_DAYS` (env var, default 90) and clears the column, keeping the `media_data` volume bounded. No-ops if `MEDIA_RETENTION_DAYS <= 0`.
- **Bot reply humanization** (`WABot.humanizeEnabled`, opt-in, default `false`): when on, `bot-worker.ts` splits the reply on blank lines (`lib/whatsapp/humanize.ts:splitReply()`) and enqueues each chunk on `bot-message-send` with a cumulative simulated-typing delay (`computeTypingDelay()`, ~40ms/char, capped 0.8–8s) instead of calling `sendWhatsAppMessage()` synchronously — keeps the main `bot-messages` job from holding its concurrency slot for the whole send sequence. `bot-send-worker.ts:processBotSendJob()` re-fetches the `WAAccount` and does the actual send + `WAMessage`/`WAChat` bookkeeping per chunk. Tone/pacing only — never use this to imply the chat isn't automated (WhatsApp's Business Messaging Policy expects disclosure where applicable).
- Workers live in `lib/workers/`. Queue definitions in `lib/queue.ts`.
- `REDIS_URL` env var required.
- `defaultJobOptions` include `attempts: 3`, `backoff: exponential`, `removeOnComplete: 100`, `removeOnFail: 50`.
- Workers have graceful shutdown on `SIGTERM`/`SIGINT`.
- `lib/redis.ts` exports `getRedisClient()` — singleton with retry strategy. Use this, not new connections.
- `lib/rate-limit.ts` — sliding-window rate limiter with Redis + in-memory fallback (fail-safe). Add to any new auth-sensitive endpoint.

## AI providers

Two providers: `openrouter` (OpenAI-compatible SDK, baseURL override) and `google` (native Gemini SDK). API keys stored **per-user** in `AppSettings`, not per-bot. Encrypted with AES-256-GCM (`lib/crypto.ts`).

Provider clients in `lib/ai/providers/`. Factory in `lib/ai/factory.ts`.

- **Multimodal in/out**: `AIMessage.content` is `string | ContentPart[]` where `ContentPart` is `{type:"text",text}`, `{type:"image_url",image_url:{url}}` or `{type:"audio_url",audio_url:{url}}`. Both providers forward arrays natively. The Google provider maps `image_url`/`audio_url` with a `data:` URI base64 into `inlineData: {mimeType, data}`; plain URLs (non-data-URI) are NOT supported inside inlineData — bot-worker always builds data-URI from local bytes. **Audio input is Gemini-only** (`bot-worker.ts` gates `isAudio` on `provider === "google"`; OpenAI's chat shape has no generic audio part). **Documents** (PDF/`text/*`) are provider-agnostic: `lib/whatsapp/extract-document-text.ts` extracts text server-side (max 6000 chars) and injects it as a plain text part. Bot reply stays text-only (media input, no media output).
- **Embedding dimension**: 768 for both providers (OpenRouter uses `dimensions: 768` param; Google `text-embedding-004` natively outputs 768).
- **Google usage**: `usageMetadata` on `response` object provides `promptTokenCount`, `candidatesTokenCount`. Must be returned in `AICompletionResponse.usage`.
- **Google `systemInstruction` gotcha**: must be passed to `genAI.getGenerativeModel({ model, systemInstruction })`, never to `.startChat({ systemInstruction })`. The SDK (`@google/generative-ai`) only runs its string→`Content` formatting on the value passed to `getGenerativeModel`; passing it to `startChat` instead silently overrides the formatted value with the raw unformatted one and the REST API rejects it with a 400 on `system_instruction`. **Caveat**: only a `string` `systemInstruction` is supported by the v1 SDK path — if you pass it parts/array, the formatter will mangle it. Always send a plain string for the system prompt even when the rest of the conversation is multimodal. The provider **concatenates all `system`-role messages** (`join("\n\n")`) into that single `systemInstruction` — the pipeline sends several (wrapped user prompt, RAG context, guardrail, campaign note) and an earlier version silently dropped all but the first.
- Model pricing in `lib/ai/pricing.ts` (USD per 1M tokens). `estimateCost()` is async — falls back to live OpenRouter pricing (`lib/ai/models.ts:getOpenRouterModelPricing()`, cached in-process) when an **openrouter-provider** model isn't in the static table. **Google has no pricing API** — its entries in the static table are hand-maintained (last verified 2026-07-15); a Google model missing from the table logs cost $0 with a console warning, so add pricing when adopting a new Gemini model or `WABotUsage.estimatedCost`/the budget silently undercount. Usage logged per interaction in `WABotUsage`.
- Model lists are fetched live from each provider (`lib/ai/models.ts`, exposed via `GET /api/configuracion/ia/models?provider=`) rather than hardcoded — provider catalogs change (e.g. `anthropic/claude-3.5-sonnet` was removed from OpenRouter). Bot creation and default-model settings both use this with a small static fallback list if the fetch fails.
- RAG: documents chunked → embeddings generated → stored in pgvector → searched with cosine similarity (`<=>` operator).
- **Vision model cost**: each image in context ≈ +800-1500 tokens. Bot history is text-only (no past images forwarded); only the *current* user image becomes an `image_url` part in the `user` turn. The worker re-reads `WAMessage.mediaUrl` from DB if the Meta download job hasn't finished populating the local path yet.
- **Vision capability check**: there's no enforced gate on per-model vision capability — if a model isn't vision-capable it will error on the multimodal turn, which the bot-worker catch sets `WABot.status: "ERROR"` (same as any other AI failure). Currently known vision-capable models: Gemini 1.5/2.0 Flash/Pro, OpenRouter `openai/gpt-4o`, `anthropic/claude-3.5-sonnet`, `google/gemini-2.0-flash-*`.
- **Lead scorer bots** (`WALeadScorerBot`) reuse the same provider/model/API-key plumbing as `WABot` (own `provider`+`model`+`systemPrompt`, resolved via the same `getUserApiKey()`) but score a conversation on demand instead of replying to it — see "Lead scoring" under CRM below.
- **User-configured system prompts are wrapped, not sent raw**: `lib/ai/prompt-sanitizer.ts:wrapUserPrompt()` frames both `WABot.systemPrompt` (`bot-worker.ts`) and `WALeadScorerBot.systemPrompt` (`score/route.ts`) inside a delimited `<user_instructions>` block with an explicit "treat as data, not instructions" preamble and a length cap — mitigates prompt injection against the system messages that follow (RAG context, memory summary, the scorer's JSON contract). The scorer's JSON contract also now asks for a fenced ` ```json ` block; `parseScoreResponse()` tries that first and falls back to the old greedy `{...}` regex for models that ignore the fencing instruction. `prompt-sanitizer.ts` also exports `SCOPE_GUARDRAIL` — a fixed system message (priority over `<user_instructions>` and any user/media content) appended by `bot-worker.ts` and `lib/whatsapp/lead-recovery.ts`; include it in any new AI flow that converses with end users.
- **Model list race on provider switch**: `configuracion/ia/page.tsx` and `bots/_form.tsx` both track a `modelsProvider` state alongside the fetched `models` list, and only snap the selected model to `models[0].id` once `modelsProvider` matches the currently selected `provider`. Fetching the model list is async — without this guard, switching OpenRouter→Google right after load/save could persist an OpenRouter-shaped model id under the Google provider.

### Creating templates for Meta
`lib/whatsapp/templates.ts` — `createTemplate(wabaId, accessToken, input)` calls `POST /{waba_id}/message_templates`. Constructs the payload from Zod-validated input. API route at `app/api/whatsapp/templates/create/route.ts`.

- **Media headers require the Resumable Upload API, not a URL.** A template with an IMAGE/VIDEO/DOCUMENT header needs `example.header_handle` — a handle string obtained via Meta's separate Resumable Upload API (`POST /{app-id}/uploads` → `POST /{upload-session-id}` with the raw bytes), implemented in `lib/whatsapp/resumable-upload.ts:uploadTemplateHeaderMedia()`. This is a **different** endpoint/credential shape than `lib/whatsapp.ts:uploadMedia()` (the `/{phone-number-id}/media` endpoint used for sending messages and campaign header media by `id` — see below) — a message-media ID is not a valid `header_handle` and vice versa. `POST /api/whatsapp/templates/upload-media` wraps this for the UI; requires `WAAccount.appId` to be set (see "Multiple numbers, each on its own Meta App"), otherwise returns a clear 400 telling the user to set it.
- `whatsapp/plantillas/_form.tsx` uploads the header file directly (`headerExampleHandle` state, not a pasted URL) and renders a live preview via the shared `<TemplatePreview>` component (`app/components/whatsapp/template-preview.tsx`) — the same component used in `campanas/nueva/page.tsx`, so the "what the recipient will see" preview looks identical whether you're creating the template or launching a campaign with it.
- **Template metrics**: `lib/whatsapp/template-analytics.ts` pulls Meta's `template_analytics` (sent/delivered/read/clicked per UTC day) via a field expansion on the WABA node; exposed at `GET /api/whatsapp/templates/[id]/analytics` and rendered by `template-metrics-modal.tsx` from the Plantillas list.

## Encryption

AES-256-GCM with random 12-byte IV + 16-byte auth tag. Format: `hex(iv):hex(authTag):hex(ciphertext)`. Key from `ENCRYPTION_KEY` env var (64 hex chars = 32 bytes generated via `openssl rand -hex 32`).

Fields encrypted at rest: `WAAccount.accessToken`, `WAAccount.appSecret`, `AppSettings.openrouterApiKey`, `AppSettings.googleApiKey`.

## Webhook

`POST /api/whatsapp/webhook` handles Meta webhook. Key behaviors:
- Validates `X-Hub-Signature-256` **when `appSecret` is configured** on the matched account — rejects the payload if the HMAC doesn't match. `appSecret` is optional (Meta itself doesn't require it either); if an account has none set, signature validation is skipped for that account's payloads and the request is trusted based on the `phone_number_id` match alone. This is an intentional product decision, not a gap to close — don't "fix" it into a hard requirement without checking with the user first.
- Per-message logic (Contact upsert, chat upsert, `WAMessage` create, notification, bot enqueue, media-download enqueue, auto-assignment) lives in `lib/whatsapp/ingest-message.ts:ingestInboundMessage()`. The webhook route itself just parses Meta's payload shape and calls it per message. `ingestInboundMessage()` returns `{messageId, chatId} | null` (null = deduplicated by wamid).
- Maps all 4 Meta statuses to `WACampaignRecipient`: `sent → SENT`, `delivered → DELIVERED`, `read → READ`, `failed → FAILED`.
- Detects groups: `remoteJid.includes("@g.us")` → `isGroup = true`.
- For inbound media with a Meta `mediaId` and no local path yet, the webhook enqueues a `media-download` job (see Redis queues).
- **Subscribed webhook fields beyond `messages`**: `phone_number_quality_update`, `account_update`, `user_preferences` (configure these in each Meta App's WhatsApp product webhook alongside `messages`/`message_template_status_update` — `message_template_status_update` itself isn't consumed by the webhook, template status is instead refreshed by polling in `GET /api/whatsapp/templates`, see "Creating templates for Meta"). Any other field arrives at the same URL and is silently ignored (`change.field` doesn't match any handled branch).
  - `phone_number_quality_update` and `account_update` are **not** per-message payloads — they carry no `metadata.phone_number_id`, only a phone number string (`display_phone_number` / `phone_number`) and the WABA id (`entry.id`). The account is resolved via `resolveAccountByWabaAndPhone()`: if exactly one `WAAccount` matches `wabaId`, it's used directly; if several accounts share that WABA, the reported phone number (digit-normalized) disambiguates. If neither is possible, the event is logged and dropped rather than guessed.
  - `phone_number_quality_update` updates `WAAccount.qualityRating`/`messagingTier`/`qualityUpdatedAt` (shown on the account detail page) and fires an `ACCOUNT_STATUS` notification only on a negative signal (rating/event matching `flag|downgrade|red|yellow`) — upgrades don't notify, only the badge updates.
  - `account_update` flips `WAAccount.status` to `ERROR` (with `errorMessage`) when the event or `ban_info` indicates a ban/restriction (`ban|disable|restrict|flag` in the event name); any other event still fires an informational `ACCOUNT_STATUS` notification without touching `status`.
  - `user_preferences` **is** per-number (carries `metadata.phone_number_id` like `messages`) and reports a lead opting out/in of marketing messages via WhatsApp's native mechanism (`category: "marketing_messages"`, `value: "stop"|"resume"`). Sets `Contact.optedOutMarketing`/`optedOutAt`. `campaign-worker.ts` excludes opted-out contacts from every future campaign send (marks the recipient `FAILED` with an explanatory `errorMessage` instead of calling Meta) — this doesn't affect manual/bot replies in an already-open chat, only campaign broadcast sends.

## Media handling

WhatsApp media is **binary-byte persisted locally on disk** (not just Meta URL references), so chat UI and bot vision can stream/read it without depending on Meta's short-lived (≈minutes) download URLs.

- **Storage**: `lib/whatsapp/media-store.ts` — `saveMediaFromMeta(accountId, mediaId, encryptedAccessToken)` (Meta fetch), `saveMediaFromBuffer(accountId, buffer, mimeType)` (persists a buffer already in memory — used for outbound Meta media uploads), `mediaReadStream(relativePath)` (fs stream), `resolveAbsolutePath(relativePath)` (with `..` traversal guard), `mediaEndpointFor(messageId)` (returns the proxy URL the UI must use). The pure helpers (`mediaEndpointFor`, `is*Mime`, `mimeTypeToExtension`) actually live in `lib/whatsapp/media-shared.ts` — a client-safe module with no `fs` imports that `chat-workspace.tsx` imports directly (importing `media-store.ts` from a client component would break the bundle); `media-store.ts` re-exports them for server consumers.
- **Path scheme**: `mediaUrl` stored on `WAMessage` is a path *relative* to `MEDIA_ROOT` (e.g. `<accountId>/<uuid>.<ext>`). All helpers accept/return relative paths; resolve to absolute only at the boundary.
- **Proxied serving**: `GET /api/whatsapp/messages/[messageId]/media` looks up the `WAMessage`, verifies `chat.accountId ∈ getUserAccountIds(session.user.id)`, streams bytes with `Content-Type: mimeType` and `Content-Disposition` (inline for image/audio/video, attachment for documents). Auth check is mandatory — without it any authenticated user could fetch any media by `messageId`.
- **Outbound upload (Meta only)**: `POST /api/whatsapp/media` accepts multipart `file` + `accountId`, validates ownership + that the account is `META_CLOUD`, calls `uploadMedia(phoneNumberId, accessToken, file, name, mime)` (`lib/whatsapp.ts`, `POST /{phone_number_id}/media` Graph endpoint) which returns a Meta `mediaId`, then also persists a local copy for the outbound history. Rate-limited via `rateLimit()`. Returns `{ mediaId, mimeType, filename, localMediaPath, bytesSize }` to be passed to the send route as-is.
- **Chat composer** (`whatsapp/chat/[accountId]/[chatId]/page.tsx`) has a clip 📎 button (`Paperclip` icon, accent-color, left of the text input) that opens a hidden `<input type="file">` accepting `image/*,audio/*,video/*,application/pdf,text/plain`, max 20MB. Caption goes in the text input. The send flow is: upload → `/api/whatsapp/chats/[chatId]/send` with `{type, mediaId, mimeType, filename, localMediaPath, bytesSize, caption}`.
- **UI rendering**: `MessageBubble` switches on `messageType` (`image`/`audio`/`video`/`document`/`sticker`) and renders the appropriate tag pointing at `/api/whatsapp/messages/[id]/media`. While `mediaUrl` is null (async download still queued), shows a placeholder (`[imagen recibida]` etc.) — the 5s polling in the chat page picks up the populated row once the worker finishes.
- **Bot media input**: `lib/workers/bot-worker.ts:buildUserContent()` reads the inbound media's local bytes from disk → base64 data-URI part. Images → `image_url` (both providers); audio → `audio_url` (**Gemini-only** — on OpenRouter the bot falls back to a text label); documents → text extracted via `extract-document-text.ts` (PDF/`text/*`, provider-agnostic; other MIME types fall back to a label with the filename). Media in history turns is NOT forwarded (text-only) to bound token cost. `bot-worker` re-checks Prisma for `mediaUrl` if the enqueue payload's `localMediaPath` is empty (situation: bot job fired before `media-download` worker finished).

## WhatsApp Business Cloud API

Single channel today — `WAAccount.channel` is an enum (`WAChannel`) kept for future extensibility but only has one value, `META_CLOUD`. The `BAILEYS` channel (unofficial WhatsApp Web protocol, used for dev/testing without a public webhook URL) was removed: `lib/whatsapp-baileys/`, its API routes, and the `WABaileysSession` model are gone. `phoneNumberId`/`accessToken`/`wabaId`/`verifyTokenHash`/`appSecret` stay nullable on `WAAccount` because they're filled in during the account setup wizard, not because of a second channel.

- Outbound sends always go through `lib/whatsapp/send.ts:sendWhatsAppMessage(account, params)` (decrypts the token, delegates to `lib/whatsapp.ts:sendMessage()`) — keep using this wrapper from routes/workers rather than calling `sendMessage()` directly, so token decryption stays in one place.
- Template creation and bulk campaigns require `wabaId` + `accessToken` on the account (checked via `account.channel !== "META_CLOUD" || !account.wabaId || !account.accessToken` in `templates/route.ts`, `templates/create/route.ts`, `campaign-worker.ts` — the channel check is a no-op today but keeps the guard shape if a second channel ever comes back).
- **`WAAccount.appId`** — Meta App ID, distinct from `wabaId`. Only needed for the Resumable Upload API used when creating a template with a media (IMAGE/VIDEO/DOCUMENT) header — see `lib/whatsapp/resumable-upload.ts` and `POST /api/whatsapp/templates/upload-media`. Nullable/optional; accounts that only ever use text-header or headerless templates don't need it.

### Multiple numbers, each on its own Meta App

Every `WAAccount` is fully self-contained — `phoneNumberId`, `wabaId`, `accessToken`, `appSecret`, `verifyTokenHash`, `appId` — and every Graph API call site resolves these from the specific account row, never from a shared/global credential. There's no `META_APP_ID`-style env var and no assumption anywhere that all connected numbers belong to the same Meta App. Practical implications:

- When connecting a second (or Nth) number under a **different** Meta App, use that App's own App ID/App Secret/access token in "Agregar número" — don't reuse another account's values.
- All accounts share the same webhook URL (`/api/whatsapp/webhook`) — the system disambiguates inbound payloads by `phone_number_id` and the GET verification handshake by `verify_token` (both looked up per-account, see "Webhook" above), so multiple Meta Apps can point their WhatsApp product webhook config at the same URL without conflict.
- Manual steps on Meta's side that this system does **not** automate: in the new Meta App, set the WhatsApp product webhook to our URL + that account's generated verify token, and confirm the WABA is subscribed to that App's webhook (`POST /{waba-id}/subscribed_apps` — usually already done when the number was configured in Meta Business Manager, but worth checking first if inbound messages aren't arriving).

## CRM & team collaboration

- `Contact` (tags via `Tag`/`ContactTag`, `leadStatus`, notes via `WANote`) is auto-upserted per remote JID inside `ingestInboundMessage()` — one per `(accountId, remoteJid)`, 1:1 with `WAChat` via `WAChat.contactId`. Surfaced through `ContactDrawer` (`app/components/whatsapp/contact-drawer.tsx`) from both chat views and `/whatsapp/contactos`. **Name never regresses**: `ingest-message.ts:isFallbackName()` treats a name equal to the remote JID/phone number as "no real name" — `Contact.name`/`WAChat.name` only get overwritten with a new value if it's a real name or the existing one was itself a fallback, so a previously-learned name can't be clobbered by a later payload where Meta omits `profile.name`. `/whatsapp/contactos` also shows a Teléfono column (always) and a Cuenta column (only when the user has 2+ accounts).
- Chat assignment: `WAChat.assignedToId` restricted to the account owner + `WAAccountShare` grantees (`lib/chat-assignees.ts:getEligibleAssignees()`, the shared candidate pool used everywhere assignment/mentions/auto-assign need "who can touch this account"). Assigning manually triggers no side effect by itself; a `CHAT_MESSAGE` notification fires on the *next* inbound message if the chat is already assigned (or gets auto-assigned, see below).
- `Notification` model + polling bell (`app/components/ui/notification-bell.tsx`, polls `GET /api/whatsapp/notifications` every 25s). Types: `CHAT_MESSAGE`, `CAMPAIGN_COMPLETED`, `CAMPAIGN_FAILED`, `BOT_ERROR`, `BUDGET_EXCEEDED`. No websockets in this app — polling is the established pattern for anything "live."
- Monthly AI budget: `AppSettings.monthlyBudgetUsd` (optional) + `budgetAlertMonth` (guards against re-notifying within the same month). Checked in `bot-worker.ts` after every logged `WABotUsage` row. **All three AI consumers gate on `isMonthlyBudgetExceeded()` before spending**: lead-scoring and lead-recovery skip their tick, and `bot-worker.ts` skips the reply (logs, no `ERROR` status — it's not a bot failure) once the budget is spent.
- **Campaign sends create CRM records**: a successfully delivered campaign recipient now upserts a `Contact`/`WAChat`/`WAMessage` (`direction: OUTBOUND`, `messageType: "template"`) and tags both the contact and chat with `Campaña: <campaign name>` (`lib/workers/campaign-worker.ts`) — so campaign leads show up in `/whatsapp/contactos` and the chat list, not just in `WACampaignRecipient`. A recipient that fails to send leaves no CRM trace (no phantom contact). `WAMessage.body` for this record holds the real rendered template text (`lib/whatsapp/template-variables.ts:renderTemplateText()`, substitutes `{{n}}` the same way `<TemplatePreview>` does for display), and `WAMessage.campaignId` (FK to `WACampaign`) attributes the message so `bot-worker.ts` can inject a one-line "this chat started from campaign X, template Y" system note when the most recent outbound message in the chat came from a campaign — regardless of `bot.memoryType`. A campaign's image/video header is persisted locally **once per campaign** (not re-downloaded per recipient) and each recipient's `WAMessage` points at that copy, so the header renders in the chat via the same `<MediaContent>`/media-proxy path as any other media.
- **Campaign template variables** (`whatsapp/campanas/nueva/page.tsx`): `lib/whatsapp/template-variables.ts:getTemplateVariables(components)` (shared by the UI and `campaign-worker.ts`) inspects a template's raw Meta `components` JSON to detect what needs a value — body `{{n}}` count (per-recipient, `WACampaignRecipient.parameters`), header text/media (campaign-wide, `WACampaign.headerParam` — media headers hold a Meta message-media `id`, uploaded via `/api/whatsapp/media`, not a URL), and a URL button's dynamic suffix (campaign-wide, `WACampaign.buttonParam`). Footer never has variables in Meta's template model. The worker resolves the button's array index from the template's own `BUTTONS` component so the `sub_type: "url"` component always targets the right button.
- **Recipient CSV import** (`lib/whatsapp/parse-csv.ts`) expects a header row (`telefono`/`nombre` recognized by name, any other columns become body parameters in file order) and shows a read-only, paginated (10/page) preview via the shared `<Table>` — imported rows are kept in a separate array from manually-typed rows rather than rendered as hundreds of editable inputs.

### Lead scoring (`WALeadScorerBot` / `WALeadScore`)

Distinct from the AI reply bots (`WABot`): a `WALeadScorerBot` (own `name`/`provider`/`model`/`systemPrompt`, CRUD at `/whatsapp/calificadores`) scores a *conversation transcript* on demand rather than replying to it. `POST /api/whatsapp/chats/[chatId]/score` requires a `scorerId` in the body, loads that scorer's config + the chat's messages, and asks the AI for `{score (0-100), label: "frio"|"tibio"|"caliente", summary, reasons[]}` via a fixed JSON-contract system message appended after the scorer's own system prompt. The result is upserted on `@@unique([chatId, scorerId])` — **a chat can carry one score per scorer**, not a single global score; don't assume `WALeadScore` is 1:1 with `WAChat`. `GET` on the same route returns all scores for the chat (one per scorer that has run so far). `GET /api/whatsapp/chats/[chatId]/scorers` lists the account owner's active scorers for the picker. `LeadScoreBadge` (popover in the chat header) lets the user pick a scorer, re-run it, and flip between scorers' past results.

The actual scoring logic (transcript build, AI call, JSON parse, `WALeadScore` upsert, usage logging) lives in `lib/whatsapp/lead-scoring.ts:scoreChatWithScorer(chatId, scorer)`, shared by both the manual "Calificar" button and the scheduled tick worker below — don't duplicate this logic inline in a route handler.

`/whatsapp/calificadores` has two in-page tabs (client-side `useState`, same idiom as `bots/[id]/page.tsx`): **Calificadores** (CRUD list; hidden entirely for role `user`, see roles) and **Leads calificados** (`GET /api/whatsapp/lead-scores`, all `WALeadScore` rows across the user's accounts) — the latter is the cross-chat view of everything any scorer has produced so far. The Leads tab filters client-side by scorer/label/account/phone/date range, paginates client-side (`<Pagination>`, slice over the filtered array), opens a per-lead detail modal, and exports CSV via a column/scope-picker modal (`lib/csv.ts:toCsv()/downloadCsv()` — reuse these for any new CSV export).

Beyond `{score, label, summary, reasons[]}`, the JSON contract asks for a structured `details` object (buying signals, objections, next steps, product of interest — the 5-phase methodology prompt in `lib/whatsapp/lead-scoring.ts` dictates its shape), persisted as `WALeadScore.details Json?` — a flexible blob on purpose, don't normalize it into columns.

**Scheduled/periodic scoring**: `WALeadScorerBot.scheduleEnabled` + `scheduleIntervalMinutes` (one of `LEAD_SCORER_SCHEDULE_INTERVALS` in `lib/validations.ts` — 15/30/60/180/360/720/1440) + `scheduleAccountIds` (`String[]`, empty = all the owner's accounts) let a scorer re-run itself unattended instead of only via the manual button. A single BullMQ repeatable job (`lead-scoring` queue, `lib/workers/lead-scoring-worker.ts`, cron `*/5 * * * *`, registered in `lib/workers/index.ts`) ticks every 5 minutes — the shortest resolution needed since 15 min is the smallest selectable interval — and for each due scorer (`now - lastRunAt >= scheduleIntervalMinutes`) re-scores up to 15 of its owner's `OPEN`/`PENDING` chats that either have never been scored by it or have new messages since the last score (`WAChat.lastMessageAt > WALeadScore.updatedAt`), then stamps `lastRunAt`. Before running, it checks `isMonthlyBudgetExceeded()` (`lib/ai/budget.ts`) and skips the whole scorer for that tick if the user's monthly AI budget is already spent — unattended runs don't get to blow through a budget the way a human clicking a button implicitly self-limits.
- **Usage/cost tracking**: unlike the original manual-only flow, every scored chat now logs a `WALeadScorerUsage` row (mirrors `WABotUsage` — tokens + `estimatedCost`), and `lib/ai/budget.ts:getMonthlyAiCost()`/`checkBudgetAlert()` sum **both** `WABotUsage` and `WALeadScorerUsage` — the monthly budget and the `BUDGET_EXCEEDED` notification reflect total AI spend, not just reply-bot spend. `lib/estadisticas/get-stats.ts`'s `totalCost`/`totalTokens`/`monthlyCost` were updated the same way. If you add a third kind of AI usage in the future, extend `getMonthlyAiCost()` rather than adding a parallel budget check.

### Lead recovery (`WALeadRecoveryAttempt`)

Autonomous re-engagement of leads that went silent ("en visto"). Config lives **per user** on `AppSettings` (`leadRecoveryEnabled` — default `false`, `leadRecoveryFirstMessageHours`/`leadRecoverySecondMessageHours` (`null` = only 1 attempt), business-hours window `leadRecoveryBusinessHourStart/End` + `leadRecoveryTimezone`), edited from the admin-only `/configuracion/ia` page. The `lead-recovery` queue ticks every 15 min (`lib/workers/lead-recovery-worker.ts:processLeadRecoveryTick()`):

- Per enabled user: skips the whole tick if `isMonthlyBudgetExceeded()` or outside business hours (checked in the user's configured timezone).
- Candidates: `OPEN`/`PENDING` chats across `getUserAccountIds()` whose **last message is OUTBOUND** and that have at least one INBOUND message ever (a campaign recipient who never replied is not an "abandoned" lead). Bounded per tick: `CANDIDATE_POOL = 200`, `BATCH_SIZE = 20` sends max.
- Attempt logic: hours of silence measured from the lead's last inbound; `WALeadRecoveryAttempt` rows created *after* that inbound count as attempts (so a lead who replies resets the sequence). Max 2 attempts.
- The message is **generated by the account's active `WABot`** (`lib/whatsapp/lead-recovery.ts:sendRecoveryMessage()` — coherent with the conversation, wrapped prompt + `SCOPE_GUARDRAIL`); accounts without an active bot are skipped.
- **Meta 24h window**: only free-text messages inside Meta's 24h customer-service window (from the lead's last inbound) are sent — past 24h it sends nothing (no reactivation template configured yet).

This runs unattended and messages real leads — treat `leadRecoveryEnabled` and the hour thresholds as production-sensitive settings; never flip them in the DB while testing without telling the user.

### Conversation-level features (distinct from Contact-level)

These mirror equivalent Contact-level concepts but are **separate models** scoped to the `WAChat` itself, not the underlying lead/contact — don't conflate them:

- **`WAChat.status`** (`ChatStatus`: `OPEN`/`PENDING`/`RESOLVED`, default `OPEN`) + `resolvedAt` (set when transitioning to `RESOLVED`, cleared on reopen). `PATCH /api/whatsapp/chats/[chatId]/status`, changed from the chat header. `GET /api/whatsapp/chats` still supports `?status=` (comma-separated), but the inbox no longer renders status tabs — they were removed along with the whole `WAChatNote` internal-notes feature (model, routes, drawer, `@mention` parsing and the `NOTE_MENTION` notification type all deleted for lack of use; `WANote` on Contact remains). Don't re-introduce either without asking.
- **Inbox filters** (`chat-workspace.tsx`): campaign (`?campaignId=`, a relation filter on `WAMessage.campaignId` — not the `Campaña: X` text tag) and lead-reply (`?hasReplied=yes|no`). Each chat row shows a campaign badge (most recent campaign-tagged message) with a hash-derived tone. The `/whatsapp/chat` area renders **full-bleed** — `app-shell.tsx` drops the standard page padding + breadcrumb when `pathname.startsWith("/whatsapp/chat")` (`h-svh`, internal scroll).
- **Per-chat AI cost**: `GET /api/whatsapp/chats/[chatId]/usage` returns the per-interaction list (bot replies + scorer runs — `WABotUsage` + `WALeadScorerUsage` by `waChatId`) with model/tokens/`estimatedCost`; surfaced as a cost badge with breakdown in the chat header. It's per *AI call*, not per message (a humanized reply spans several `WAMessage` chunks from one call).
- **`ChatTag`** (bridge table, same shape as `ContactTag` but for `WAChat`) reuses the global `Tag` catalog and `/api/whatsapp/tags` GET/POST as-is. Chat-scoped CRUD at `/api/whatsapp/chats/[chatId]/tags`, UI in `chat-tag-picker.tsx` (popover in the chat header, *not* a drawer).
- **`CannedResponse`** (per-`waAccountId`, `shortcut` + `content`, shared across everyone with access to that account) — managed from the "Respuestas rápidas" section embedded in `/configuracion` (`configuracion/_respuestas-rapidas.tsx` + its `_respuestas-rapidas-form.tsx` modal; the old standalone `/configuracion/respuestas-rapidas` page was folded in during the 2026-07 nav flattening). In the chat composer, typing `/shortcut` filters and shows a dropdown; Tab or click inserts the full `content`.
- **Auto-assignment** (`lib/whatsapp/auto-assign.ts:autoAssignChat()`) — opt-in per account via `WAAccount.autoAssignEnabled` (toggle on the account detail page), off by default so it never silently changes existing manual-assignment behavior. When enabled, an unassigned inbound message is routed to the eligible candidate (`getEligibleAssignees()`) with the fewest `OPEN`/`PENDING` chats, respecting `User.maxOpenChats` (`null` = unlimited; candidates at their cap are skipped). Wired into `ingestInboundMessage()` right before the `CHAT_MESSAGE` notification check.
- **Per-agent metrics**: `WAMessage.senderId` records which human sent a manual outbound reply (set in `chats/[chatId]/send/route.ts`; bot replies leave it `null` — bots are tracked separately via `WABotConversation`). `WAChat.firstResponseAt` is stamped the first time a manual reply is sent on a chat. `lib/estadisticas/get-stats.ts` aggregates these (in JS, not SQL — Prisma can't `AVG()` a date difference) into `agentPerformance` (resolved count, avg minutes to first response, avg minutes to resolution), rendered in `estadisticas/_view.tsx`.

## Design system

All tokens in `app/globals.css` as CSS custom properties. Accent: refined WhatsApp green (`#22C55E` dark, `#15803D` light — evolved from the original flatter `#25D366`/`#1ea952` to feel less like a literal WhatsApp clone while keeping the brand association). **Neutrals are warm (2026-07 "Conversación primero" redesign)**: dark surfaces are warm charcoal (`#14120f` family, earthy hue — the green lives only in `--accent`), light surfaces warm cream/gray (`#faf9f5`/`#f3f0e9`). `success` stays teal (`#2dd4bf` dark / `#0d9488` light) so it reads distinct from `accent` — don't let them drift back to the same hue.

**Redesign identity elements** (apply with restraint, they're the signature — not defaults):
- **Bubble corner**: `rounded-bubble` (small corner bottom-left) / `rounded-bubble-br` (bottom-right), defined as `@utility` in `globals.css`. Whitelist: `EntityAvatar`, primary `Button` variant, active sidebar item, own chat bubbles. Don't spread it to arbitrary surfaces.
- **Per-entity hue**: 8 `.hue-0`…`.hue-7` classes set `--entity`/`--entity-bg` (oklch, light/dark aware, hues avoid accent-green ~150° and success-teal ~180°), consumed via `bg-entity`/`text-entity`/`bg-entity-bg` utilities. **Only** assign via `HUE_CLASS[hueIndex(id)]`/`hueClassFor(id)` from `app/components/ui/hue.ts` (hash keyed by `accountId` so one WhatsApp number = one color everywhere) — never interpolate `hue-${n}`.
- **Type scale**: `text-hero` (2.75rem, hero numbers), `text-page-title` (h1, rendered in Fraunces via `PageHeader`), `text-eyebrow` (section eyebrows). Every figure/phone/date/metric renders in `font-mono` (IBM Plex); Fraunces (`font-display`) is for page titles and section headings only.

**Never** write inline button/card/input classes. **Never** use Tailwind color literals. Use semantic tokens: `text-accent`, `bg-surface`, `text-muted`, `text-success`, etc.

Form pattern: `<FormField label="…" error={…}>{(id) => (<Input id={id} … />)}</FormField>`

Toast: `const { success, error } = useToast()` → `success("text")`

Three select flavors in `app/components/ui/` — pick by need, don't build a fourth: `select.tsx` (styled native `<select>`, short lists), `multi-select.tsx` (checkbox multi-select), `searchable-select.tsx` (`SearchableSelect`, single-select combobox with a search input that only starts filtering at ≥3 chars — below that the full list stays visible; used for long lists like the template picker in `campanas/nueva`). `pagination.tsx` (`<Pagination currentPage totalPages onPageChange>`) is the shared pager for client-side paginated lists.

### Layout: workbench (overview pages) + `EntityList` (entity lists)

The 2026-07 redesign replaced the old BentoGrid/TileGrid tile system (deleted: `bento-grid.tsx`, `tile-grid.tsx`, `stat-card.tsx`, `SkeletonCard`) with an editorial "workbench" layout. Primitives, all in `app/components/ui/`:

- **`kpi-strip.tsx`** (`KpiStrip`, `KpiItem`) — single dense row of KPIs with vertical dividers, no boxes/icons. Values are pre-formatted strings in `font-mono`; `delta?`/`deltaTone?` for secondary figures, `href?` wraps the cell in a `Link`, `size="hero"|"compact"`. **Deliberately server-safe and icon-free**: no icon props means RSCs (`dashboard/page.tsx`) use it directly without hitting the "functions cannot be passed to Client Components" error.
- **`section-header.tsx`** (`SectionHeader`) — eyebrow (uppercase `text-eyebrow`) + Fraunces title + optional `action` ReactNode. Sections separate by typography, not bordered cards. Server-safe.
- **`workbench.tsx`** (`Workbench`/`WorkbenchMain`/`WorkbenchAside`) — the `lg:grid-cols-3` editorial split (main 2/3 + aside 1/3, collapses to 1 col below `lg`). Server-safe.
- **`avatar.tsx`** (`EntityAvatar`) — initials avatar, `rounded-bubble`, hue keyed by `id` (pass `accountId` for anything WhatsApp-scoped so one number = one color across inbox/lists/overviews). Server-safe.
- **`entity-list.tsx`** (`EntityList` + `EntityRow`, `"use client"`) — dense database-style rows replacing TileGrid on entity list pages (Contactos, Plantillas, Bots, Campañas ×2 tabs, Usuarios). **Same contract TileGrid had** (`rows`/`rowKey`/`loading`/`error`/`onRetry`/`emptyIcon`/`emptyTitle`/`emptyDescription`/`emptyAction`/`onRowClick`/`rowActions`, reusing `ListErrorState`/`EmptyState`/`SkeletonRow`), with `renderTile`→`renderRow` and no `columns`. `rowActions` renders inside the same `Dropdown`+`stopPropagation()` pattern, revealed on hover/focus on `md:+` and always visible on touch. For inline (non-dropdown) per-row actions, return a fragment from `renderRow`: `<><EntityRow …/><span onClick={stopPropagation}>…buttons…</span></>` (see Bots/Usuarios/Campañas). `EntityRow` gives the standard anatomy: `leading` (usually `EntityAvatar`), `title`, `subtitle`, `badges`, `meta` (right-aligned, hidden below `sm`, figures in `font-mono`). No sort headers — pages needing ordering keep a toolbar `<Select>`.

Overview page shape (see `dashboard/page.tsx`, `estadisticas/_view.tsx`): `PageHeader` → `KpiStrip` → `Workbench` with `SectionHeader`-separated sections; entry stagger via `animate-fade-in-up` + `animation-delay-100..400`. `loading.tsx` files mirror the same skeleton shape — update them in the same change as their page.

**Form/detail pages center their narrow content**: single-column pages (`campanas/nueva`, `campanas/automatizacion/nueva`, `campanas/[id]`, `bots/[id]`, `cuentas/[id]`, `configuracion/**`) wrap everything in `max-w-{2xl|3xl|4xl} mx-auto` — a left-pinned narrow column leaves the right half of wide screens dead. The `mx-auto` is mandatory whenever a page root sets a `max-w-*`; text inside stays left-aligned.

`table.tsx`/`<Table>` is **not deprecated** — still the right tool for dense multi-column numeric reports; used inside workbench sections in `estadisticas/_view.tsx` (campaign breakdown, bot usage, agent performance).

`app/components/ui/page-header.tsx` (`title`/`description`/`actions`) renders the h1 in `font-display text-page-title` (Fraunces). Use it on every top-level list/dashboard page; detail pages with a back-link (`bots/[id]`, `campanas/[id]`, `cuentas/[id]`) keep their own back-link + heading instead.

**Chat rail**: `chat-workspace.tsx`'s conversation rail keeps its own dense inbox structure (not workbench/EntityList) — the 2026-07 redesign only skinned it: `EntityAvatar` per row, hue-colored group headers with an `animate-pulse-live` dot, own bubbles in `rounded-bubble-br`. Structure/polling/composer untouched — still confirm with the user before restructuring it.

### Create/edit modal pattern

Standard entity CRUD lives in a `_form.tsx` file next to the list's `page.tsx`, exporting a single `<XxxFormModal open onClose onSaved initialData? />` that handles both create and edit (`initialData` present ⇒ edit). Structure: `<Modal size="md|lg|xl" footer={Cancelar/Guardar}>` + `{error && <Banner tone="danger">}` + `<FormField>` blocks. See `whatsapp/plantillas/_form.tsx` as the reference implementation.

Exceptions that stay as a dedicated page instead of a modal:
- Unbounded dynamic content (`whatsapp/campanas/nueva` — recipient list can grow to hundreds of rows via CSV import; doesn't fit a modal's `max-h-[90vh]`).

Account creation (`whatsapp/cuentas/_form.tsx:CuentaFormModal`) follows the standard modal pattern but has a two-step render: the create form, then (on success) a read-only "here are your values" step showing the webhook URL and the auto-generated verify token — `verifyToken` is never typed by the user and never stored in plaintext (`WAAccount.verifyTokenHash` only), so that success step is the *only* place it's ever visible. External entry points link to `/whatsapp/cuentas?nueva=1`, which auto-opens the modal (`cuentas/page.tsx` reads the `nueva` search param into the modal's initial `open` state — wrapped in `<Suspense>` per the `useSearchParams()` rule above).

## Auth

- `lib/auth.ts` — NextAuth v5 (Credentials + bcrypt, JWT strategy only, **no adapter**)
- Server: `import { auth } from "@/lib/auth"` → `const session = await auth()`
- Client: `useSession()` from `next-auth/react`
- `SystemConfig` (singleton) controls `allowRegistration` toggle for `/register`
- `AUTH_SECRET` = base64 (generated via `openssl rand -base64 32`)

## Gotchas summary

- **`npm run build` inside the dev compose fails with `TypeError: Cannot read properties of null (reading 'useContext')` while prerendering** — `docker-compose.override.yml` sets `NODE_ENV=development`, which poisons the production build (dev React mixed into SSR chunks). It is NOT a code bug: run the build check as `docker compose run --rm -e NODE_ENV=production app sh -c "rm -rf .next && npm run build"`, then `docker compose run --rm -u root app sh -c "rm -rf .next"` + `docker compose up -d app` so the dev server doesn't boot on the production `.next`.
- **Campaign visibility is per account, not per creator** — `GET /api/whatsapp/campaigns`, the `[id]` detail/DELETE and `send` all filter by `waAccountId ∈ getUserAccountIds()`; a `WAAccountShare` grantee can create/see/send campaigns on the shared account and the owner sees them too. Don't regress these back to `userId: session.user.id`.
- **Role guards live in the APIs too, not just `proxy.ts`** — all `/api/whatsapp/bots/**` handlers 403 for any non-admin, and `GET /api/whatsapp/contacts` (the list) 403s for role `user` (the `contacts/[id]` detail stays open — the chat's ContactDrawer needs it). `PATCH /api/usuarios` refuses to demote the first-created admin or the last remaining admin.
- **Empty `public/` kills Docker build** — must have `.gitkeep`
- **`tailwindcss` in deps, not devDeps** — production builds need it
- **Shared accounts** — any route resolving a `WAAccount` from user input must check membership via `getUserAccountIds()`, **never** `findFirst({ id, userId: session.user.id })` — the latter 404s ("Cuenta no encontrada") for users who got the account via `WAAccountShare`. This exact bug shipped three times (template sync, template create, campaign create) before being fixed; grep for `userId: session.user.id` next to `wAAccount` when touching account-scoped routes.
- **Knowlege index is async** — use `ragQueue.add()`, never `indexDocument()` directly in HTTP handlers
- **RAG chunk IDs** — use `crypto.randomUUID()`, not `Date.now()`
- **Template creation** — `wabaId` must exist on the account; templates require Meta review
- **Campaign templates** — API must validate `status: "APPROVED"` in addition to existence
- **Embeddings** — dimension is 768, not 1536 (changed from original schema)
- **Rate limiting** — add `rateLimit()` to any new auth-sensitive endpoint
- **Catch blocks** — use `toastError()` not empty `{}` in client code
- **`cn()`** — simple join, no tailwind-merge (avoids Docker dep issues)
- **`login` page** — uses `Suspense` boundary for `useSearchParams("callbackUrl")`
- **Startup script** — uses `migrate deploy` when `prisma/migrations/` exists, falls back to `db push`. This repo currently has **no** `prisma/migrations/` directory — always use `npx prisma db push`, not `migrate dev`, for schema changes.
- **Dev container needs a restart after `prisma db push`** — the running `npm run dev` process keeps the pre-regeneration Prisma Client in memory; `npx prisma generate` writes new files to `node_modules` but the live process won't pick them up without `docker compose restart app` (or a full `down -v && up --build`). Queries against newly-added models/fields will 500 until restarted.
- **`WABot.status` vs `isActive`** — two separate gates. `ingestInboundMessage()`'s bot lookup requires *both* `isActive: true` and `status: "ACTIVE"`. Any unhandled error in `processBotMessageJob()` sets `status: "ERROR"` (and notifies) — toggling `isActive` back on via `POST /api/whatsapp/bots/[id]/toggle` is what resets `status` back to `"ACTIVE"`; the bot won't recover just by looking "Active" in a stale UI state. The `/test` endpoint bypasses both fields entirely, so it can succeed while the real message pipeline stays silently dead.
- **`WABot.waAccountId` is nullable** — a bot can be created and exercised via its `/test` ("Probar") tab without a WhatsApp account attached; it just never gets picked up by the real inbound pipeline (which filters by account) until one is assigned.
- **`WALeadScore` is keyed by `(chatId, scorerId)`, not just `chatId`** — a chat can carry scores from multiple `WALeadScorerBot`s at once; `findUnique({where:{chatId}})` no longer works, use the composite key.
- **`pdf-parse` must be imported as `pdf-parse/lib/pdf-parse.js`** (the inner module), never the package root — the root `index.js` has a top-level debug block gated on `!module.parent` that misfires under ESM dynamic import and crashes trying to read a bundled test fixture. See `lib/whatsapp/extract-document-text.ts`.
- **`leadRecoveryEnabled` sends real WhatsApp messages unattended** — the `lead-recovery` tick fires every 15 min regardless of app restarts. Never enable it (or shrink its hour thresholds) in a dev DB pointing at real accounts without the user's explicit OK.
- **`MEDIA_RETENTION_DAYS`** (default 90) drives the daily `media-cleanup` queue job that deletes old `WAMessage` media files — set to `0` (or leave unset with a non-positive value) to disable purging.
- **pgvector IVFFlat index** — see "pgvector" under Database; don't re-add the `CREATE INDEX` to `docker/init.sql`, it will silently no-op there.
- **Never put `<Button>` inside `<Link>`** — renders invalid HTML (`<button>` inside `<a>`). Instead: `<Button onClick={() => router.push("/path")}>` or use a plain `<a>` styled as a button.
- **`/api/whatsapp/chats` has two response shapes** — a flat array (legacy, when called with no `page` query param — no in-app consumer left since the overviews became RSC/Prisma-direct, but the shape survives for compatibility) vs. `{items, total, page, pageSize}` (when `page` is present — how `chat-workspace.tsx` calls it). Check which shape a new consumer needs before adding a call.
- **Playwright browser not installed in this environment** — `mcp__plugin_playwright_playwright__*` tools fail with "Chromium distribution 'chrome' is not found" until `npx playwright install chrome` is run; don't assume visual/browser verification is available without checking first. **However**, the plain `mcp__playwright__*` / `mcp__playwright-auth__*` tools (no `plugin_` prefix) work fine and were used successfully this session for real browser verification (login, click-through, file upload, screenshots) — check which namespace is actually available before assuming browser testing is off the table.
