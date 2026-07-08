# AGENTS.md

## Stack
- **Next.js 16** (App Router, Turbopack) + **Tailwind CSS v4** (CSS-based, `@theme inline`)
- **NextAuth v5** beta (Credentials + JWT only, no adapter)
- **Prisma 5** (PostgreSQL + pgvector)
- **Redis 7** + **BullMQ** (job queues for async processing)
- React 19, lucide-react, zod, bcryptjs, next-themes, openai, @google/generative-ai, ioredis

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
`prisma/schema.prisma` — 15 models. Key relationships: `User → WAAccount[]`, `User → AppSettings (1:1)`, `WABot ↔ WABotKnowledge (M:N via WABotKnowledgeBot)`, `WAAccount → WAAccountShare[] → User`

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
| `bot-messages` | 3 | 60s | Webhook detects active bot → enqueues |
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
- Model pricing in `lib/ai/pricing.ts` (USD per 1M tokens). Usage logged per interaction in `WABotUsage`.
- RAG: documents chunked → embeddings generated → stored in pgvector → searched with cosine similarity (`<=>` operator).

### Creating templates for Meta
`lib/whatsapp/templates.ts` — `createTemplate(wabaId, accessToken, input)` calls `POST /{waba_id}/message_templates`. Constructs the payload from Zod-validated input. API route at `app/api/whatsapp/templates/create/route.ts`.

## Encryption

AES-256-GCM with random 12-byte IV + 16-byte auth tag. Format: `hex(iv):hex(authTag):hex(ciphertext)`. Key from `ENCRYPTION_KEY` env var (64 hex chars = 32 bytes generated via `openssl rand -hex 32`).

Fields encrypted at rest: `WAAccount.accessToken`, `WAAccount.appSecret`, `AppSettings.openrouterApiKey`, `AppSettings.googleApiKey`.

## Webhook

`POST /api/whatsapp/webhook` handles Meta webhook. Key behaviors:
- **Always** validates `X-Hub-Signature-256` — rejects if signature invalid regardless of `appSecret` presence. `appSecret` is required for signature validation; if missing, webhook rejects all POSTs.
- Batch-deduplicates: collects all `wamid`s from the message batch, does a single `findMany({ where: { wamid: { in: [...] } } })`, uses a Set for O(1) lookup.
- Reuses upserted `chat` variable instead of re-querying in the bot loop.
- Maps all 4 Meta statuses to `WACampaignRecipient`: `sent → SENT`, `delivered → DELIVERED`, `read → READ`, `failed → FAILED`.
- Detects groups: `remoteJid.includes("@g.us")` → `isGroup = true`.

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
