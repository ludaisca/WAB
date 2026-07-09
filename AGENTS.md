# AGENTS.md

## Stack
- **Next.js 16** (App Router, Turbopack) + **Tailwind CSS v4** (CSS-based, `@theme inline`)
- **NextAuth v5** beta (Credentials + JWT only, no adapter)
- **Prisma 5** (PostgreSQL + pgvector)
- **Redis 7** + **BullMQ** (job queues for async processing)
- React 19, lucide-react, zod, bcryptjs, next-themes, openai, @google/generative-ai, ioredis
- `@whiskeysockets/baileys` (WhatsApp Web protocol, dev/testing channel — see "WhatsApp channels" below), `qrcode`

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
- Production `app` service uses `expose: 5000` (no fixed host port bind). Coolify's own proxy (Traefik) routes to it via the FQDN/domain configured in the Coolify UI. Do **not** add a hardcoded `ports:` mapping back to `docker-compose.yml` — a fixed host port causes `port is already allocated` failures on redeploy if a stale container from a previous deploy attempt (or another app) still holds that port on the server.

## Architecture: roles

Three roles with different UIs and access:

| Role | Sidebar | Routes blocked |
|---|---|---|
| `admin` | Panel, Estadísticas, WhatsApp, Bots, Conocimiento, Plantillas, Campañas, Usuarios, Config | none |
| `user` | Panel, Estadísticas, WhatsApp, Bots, Conocimiento, Plantillas, Campañas, Config | `/usuarios` |
| `ejecutivo` | Chats, Config | everything except `/whatsapp/chat` and `/configuracion` |

- First registered user auto-gets `admin` via atomic `$transaction(count + create)` in `app/api/auth/register/route.ts`
- Route protection in `proxy.ts` (Next.js 16 middleware)
- `dashboard-shell.tsx` builds `NAV[]` conditionally via `useSession().user.role`
- `lib/shared-accounts.ts` exports `getUserAccountIds(userId)` — own + shared accounts. Use in any new chat/message/template route that queries by account.
- `Session.user` has `id`, `email`, `name`, `role`, `createdAt` (ISO string)

## Framework quirks

- `proxy.ts` IS the middleware — Next.js 16 convention. Not `middleware.ts`
- `params` in page/layout props is `Promise<>` — must `await` before destructuring
- Server Components **cannot** pass Lucide/React components to Client Components as props. Error: "Functions cannot be passed directly to Client Components". Fix: convert the page to `"use client"` or render icons inside the client boundary
- `rm -rf .next` after adding/removing routes (stale Turbopack cache causes 404s/500s). If files are owned by Docker use `docker compose down -v && docker compose up --build` instead
- Pages using `useSearchParams()` must be wrapped in `<Suspense>`. See `app/(auth)/login/page.tsx` for pattern.

## Database

### Schema
`prisma/schema.prisma` — 21 models. Key relationships: `User → WAAccount[]`, `User → AppSettings (1:1)`, `WABot ↔ WABotKnowledge (M:N via WABotKnowledgeBot)`, `WAAccount → WAAccountShare[] → User`, `WAChat → Contact (1:1)`, `Contact ↔ Tag (M:N via ContactTag)`, `WAAccount → WABaileysSession` (1:1, only for `channel: BAILEYS`)

### Commands
```bash
npx prisma db push       # sync schema → DB (dev, creates columns)
npx prisma generate      # regenerate client after schema changes
prisma migrate dev        # create a migration (preferred for production changes)
```

### pgvector
PostgreSQL image is `pgvector/pgvector:pg16`. Extension enabled via `docker/init.sql`. Vector column is `vector(768)` — **both providers produce 768-dim embeddings** (OpenRouter `text-embedding-3-small` with `dimensions: 768`, Google `text-embedding-004`).

### Raw SQL gotcha
Prisma `$queryRawUnsafe` uses actual DB column names. Fields without `@map` use the Prisma field name as-is (camelCase). Prefer Prisma query builder over raw SQL.

### Registration
Uses `prisma.$transaction()` for atomic `count() + create()` — prevents race condition where two simultaneous registrations both get `admin`.

## Redis + BullMQ

3 queues, auto-started via `instrumentation.ts`:

| Queue | Concurrency | Timeout | Trigger |
|---|---|---|---|
| `bot-messages` | 3 | 60s | `ingestInboundMessage()` detects active bot → enqueues (both Meta webhook and Baileys) |
| `campaign-send` | 1 | 60s | Admin clicks "Enviar" on campaign |
| `rag-index` | 2 | 60s | User uploads knowledge document |

- Workers live in `lib/workers/`. Queue definitions in `lib/queue.ts`.
- `REDIS_URL` env var required.
- `defaultJobOptions` include `attempts: 3`, `backoff: exponential`, `removeOnComplete: 100`, `removeOnFail: 50`.
- Workers have graceful shutdown on `SIGTERM`/`SIGINT`.
- `lib/redis.ts` exports `getRedisClient()` — singleton with retry strategy. Use this, not new connections.
- `lib/rate-limit.ts` — sliding-window rate limiter with Redis + in-memory fallback (fail-safe). Add to any new auth-sensitive endpoint.

## AI providers

Two providers: `openrouter` (OpenAI-compatible SDK, baseURL override) and `google` (native Gemini SDK). API keys stored **per-user** in `AppSettings`, not per-bot. Encrypted with AES-256-GCM (`lib/crypto.ts`).

Provider clients in `lib/ai/providers/`. Factory in `lib/ai/factory.ts`.

- **Embedding dimension**: 768 for both providers (OpenRouter uses `dimensions: 768` param; Google `text-embedding-004` natively outputs 768).
- **Google usage**: `usageMetadata` on `response` object provides `promptTokenCount`, `candidatesTokenCount`. Must be returned in `AICompletionResponse.usage`.
- **Google `systemInstruction` gotcha**: must be passed to `genAI.getGenerativeModel({ model, systemInstruction })`, never to `.startChat({ systemInstruction })`. The SDK (`@google/generative-ai`) only runs its string→`Content` formatting on the value passed to `getGenerativeModel`; passing it to `startChat` instead silently overrides the formatted value with the raw unformatted one and the REST API rejects it with a 400 on `system_instruction`.
- Model pricing in `lib/ai/pricing.ts` (USD per 1M tokens). `estimateCost()` is async — falls back to live OpenRouter pricing (`lib/ai/models.ts:getOpenRouterModelPricing()`, cached in-process) when a model isn't in the static table. Usage logged per interaction in `WABotUsage`.
- Model lists are fetched live from each provider (`lib/ai/models.ts`, exposed via `GET /api/configuracion/ia/models?provider=`) rather than hardcoded — provider catalogs change (e.g. `anthropic/claude-3.5-sonnet` was removed from OpenRouter). Bot creation and default-model settings both use this with a small static fallback list if the fetch fails.
- RAG: documents chunked → embeddings generated → stored in pgvector → searched with cosine similarity (`<=>` operator).

### Creating templates for Meta
`lib/whatsapp/templates.ts` — `createTemplate(wabaId, accessToken, input)` calls `POST /{waba_id}/message_templates`. Constructs the payload from Zod-validated input. API route at `app/api/whatsapp/templates/create/route.ts`.

## Encryption

AES-256-GCM with random 12-byte IV + 16-byte auth tag. Format: `hex(iv):hex(authTag):hex(ciphertext)`. Key from `ENCRYPTION_KEY` env var (64 hex chars = 32 bytes generated via `openssl rand -hex 32`).

Fields encrypted at rest: `WAAccount.accessToken`, `WAAccount.appSecret`, `AppSettings.openrouterApiKey`, `AppSettings.googleApiKey`.

## Webhook

`POST /api/whatsapp/webhook` handles Meta webhook. Key behaviors:
- **Always** validates `X-Hub-Signature-256` — rejects if signature invalid regardless of `appSecret` presence. `appSecret` is required for signature validation; if missing, webhook rejects all POSTs.
- Per-message logic (Contact upsert, chat upsert, `WAMessage` create, notification, bot enqueue) lives in `lib/whatsapp/ingest-message.ts:ingestInboundMessage()` — shared with the Baileys channel (see below). The webhook route itself just parses Meta's payload shape and calls it per message.
- Maps all 4 Meta statuses to `WACampaignRecipient`: `sent → SENT`, `delivered → DELIVERED`, `read → READ`, `failed → FAILED`.
- Detects groups: `remoteJid.includes("@g.us")` → `isGroup = true`.

## WhatsApp channels (Meta Cloud API vs. Baileys)

`WAAccount.channel` (`META_CLOUD` | `BAILEYS`) distinguishes the two supported connection types.

- **`META_CLOUD`** (default, production) — official WhatsApp Cloud API. Uses `phoneNumberId`/`accessToken`/`verifyTokenHash`/`appSecret`, driven by `app/api/whatsapp/webhook/route.ts` and `lib/whatsapp.ts`.
- **`BAILEYS`** (dev/testing only) — connects via `@whiskeysockets/baileys` (unofficial WhatsApp Web multi-device protocol) after scanning a QR, so no public webhook URL is needed. **Only use with disposable test numbers — WhatsApp can ban/limit accounts using this protocol.**
  - `lib/whatsapp-baileys/connection-manager.ts` keeps a `Map<accountId, socket>` in memory, started from `instrumentation.ts` on boot (reconnects all `CONNECTED` Baileys accounts) and from `POST /api/whatsapp/accounts/baileys` (new pairing).
  - Session (Signal protocol creds/keys) persists in Postgres via `WABaileysSession.authState` (`lib/whatsapp-baileys/auth-store.ts`), not the filesystem — survives container recreation without a dedicated volume.
  - Outbound sends go through `lib/whatsapp/send.ts:sendWhatsAppMessage(account, params)`, which branches on `account.channel` — always use this wrapper, never call `lib/whatsapp.ts:sendMessage()` directly, or Baileys accounts will break.
  - **Not supported for Baileys accounts**: message templates and bulk campaigns (Meta-only concepts — account selectors in `campanas/nueva` and `plantillas` filter these accounts out), and outbound media (text only in v1).
  - Fields `phoneNumberId`/`accessToken`/`verifyTokenHash` are nullable on `WAAccount` — any code reading them must check `account.channel === "META_CLOUD"` first (see `templates/route.ts`, `templates/create/route.ts`, `campaign-worker.ts` for the pattern).

## CRM & team collaboration

- `Contact` (tags via `Tag`/`ContactTag`, `leadStatus`, notes via `WANote`) is auto-upserted per remote JID inside `ingestInboundMessage()` — one per `(accountId, remoteJid)`, 1:1 with `WAChat` via `WAChat.contactId`. Surfaced through `ContactDrawer` (`app/components/whatsapp/contact-drawer.tsx`) from both chat views and `/whatsapp/contactos`.
- Chat assignment: `WAChat.assignedToId` restricted to the account owner + `WAAccountShare` grantees (`lib/chat-assignees.ts:getEligibleAssignees()`). Assigning triggers no side effect by itself; a `CHAT_MESSAGE` notification fires on the *next* inbound message if the chat is already assigned.
- `Notification` model + polling bell (`app/components/ui/notification-bell.tsx`, polls `GET /api/whatsapp/notifications` every 25s). Types: `CHAT_MESSAGE`, `CAMPAIGN_COMPLETED`, `CAMPAIGN_FAILED`, `BOT_ERROR`, `BUDGET_EXCEEDED`. No websockets in this app — polling is the established pattern for anything "live."
- Monthly AI budget: `AppSettings.monthlyBudgetUsd` (optional) + `budgetAlertMonth` (guards against re-notifying within the same month). Checked in `bot-worker.ts` after every logged `WABotUsage` row.

## Design system

All tokens in `app/globals.css` as CSS custom properties. Accent: WhatsApp green (`#25D366` dark, `#1ea952` light).

**Never** write inline button/card/input classes. **Never** use Tailwind color literals. Use semantic tokens: `text-accent`, `bg-surface`, `text-muted`, `text-success`, etc.

Form pattern: `<FormField label="…" error={…}>{(id) => (<Input id={id} … />)}</FormField>`

Toast: `const { success, error } = useToast()` → `success("text")`

## Auth

- `lib/auth.ts` — NextAuth v5 (Credentials + bcrypt, JWT strategy only, **no adapter**)
- Server: `import { auth } from "@/lib/auth"` → `const session = await auth()`
- Client: `useSession()` from `next-auth/react`
- `SystemConfig` (singleton) controls `allowRegistration` toggle for `/register`
- `AUTH_SECRET` = base64 (generated via `openssl rand -base64 32`)

## Gotchas summary

- **Empty `public/` kills Docker build** — must have `.gitkeep`
- **`tailwindcss` in deps, not devDeps** — production builds need it
- **Shared accounts** — any new route filtering by account must call `getUserAccountIds()`
- **Knowlege index is async** — use `ragQueue.add()`, never `indexDocument()` directly in HTTP handlers
- **RAG chunk IDs** — use `crypto.randomUUID()`, not `Date.now()`
- **Template creation** — `wabaId` must exist on the account; templates require Meta review
- **Campaign templates** — API must validate `status: "APPROVED"` in addition to existence
- **Embeddings** — dimension is 768, not 1536 (changed from original schema)
- **Rate limiting** — add `rateLimit()` to any new auth-sensitive endpoint
- **Catch blocks** — use `toastError()` not empty `{}` in client code
- **`cn()`** — simple join, no tailwind-merge (avoids Docker dep issues)
- **`login` page** — uses `Suspense` boundary for `useSearchParams("callbackUrl")`
- **Startup script** — uses `migrate deploy` when `prisma/migrations/` exists, falls back to `db push`
- **Dev container needs a restart after `prisma db push`** — the running `npm run dev` process keeps the pre-regeneration Prisma Client in memory; `npx prisma generate` writes new files to `node_modules` but the live process won't pick them up without `docker compose restart app` (or a full `down -v && up --build`). Queries against newly-added models/fields will 500 until restarted.
- **`WABot.status` vs `isActive`** — two separate gates. `ingestInboundMessage()`'s bot lookup requires *both* `isActive: true` and `status: "ACTIVE"`. Any unhandled error in `processBotMessageJob()` sets `status: "ERROR"` (and notifies) — toggling `isActive` back on via `POST /api/whatsapp/bots/[id]/toggle` is what resets `status` back to `"ACTIVE"`; the bot won't recover just by looking "Active" in a stale UI state. The `/test` endpoint bypasses both fields entirely, so it can succeed while the real message pipeline stays silently dead.
- **Baileys build gotcha** — `@whiskeysockets/baileys` must stay in `next.config.ts`'s `serverExternalPackages`, or Turbopack fails the production build trying to statically resolve its optional `jimp`/`sharp` dynamic imports (which are wrapped in a runtime try/catch and never actually required unless media thumbnailing is used).
