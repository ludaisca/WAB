# AGENTS.md

## Stack
- **Next.js 16** (App Router, Turbopack) + **Tailwind CSS v4** (CSS-based, `@theme inline`)
- **NextAuth v5** beta (Credentials + JWT, Prisma adapter)
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

## Architecture: roles

Three roles with different UIs and access:

| Role | Sidebar | Routes blocked |
|---|---|---|
| `admin` | Panel, Estadísticas, WhatsApp, Bots, Conocimiento, Campañas, Usuarios, Config | none |
| `user` | Panel, Estadísticas, WhatsApp, Bots, Conocimiento, Campañas, Config | `/usuarios` |
| `ejecutivo` | Chats, Config | everything except `/whatsapp/chat` and `/configuracion` |

- First registered user auto-gets `admin` (check in `app/api/auth/register/route.ts`)
- Route protection in `proxy.ts` (Next.js 16 middleware)
- `dashboard-shell.tsx` builds `NAV[]` conditionally via `useSession().user.role`

## Framework quirks

- `proxy.ts` IS the middleware — Next.js 16 convention. Not `middleware.ts`
- `params` in page/layout props is `Promise<>` — must `await` before destructuring
- Server Components **cannot** pass Lucide/React components to Client Components as props. Error: "Functions cannot be passed directly to Client Components". Fix: convert the page to `"use client"` or render icons inside the client boundary
- `rm -rf .next` after adding/removing routes (stale Turbopack cache causes 404s/500s). If files are owned by Docker use `docker compose down -v && docker compose up --build` instead

## Database

### Schema
`prisma/schema.prisma` — 15 models. Key relationships: `User → WAAccount[]`, `User → AppSettings (1:1)`, `WABot ↔ WABotKnowledge (M:N via WABotKnowledgeBot)`, `WAAccount → WAAccountShare[] → User`

### Commands
```bash
npx prisma db push       # sync schema → DB (dev, creates columns)
npx prisma generate      # regenerate client after schema changes
```

### pgvector
PostgreSQL image is `pgvector/pgvector:pg16`. Extension enabled via `docker/init.sql` and `db-init` service. Vector column declared as `Unsupported("vector(1536)")` in schema.

### Raw SQL gotcha
Prisma `$queryRawUnsafe` uses actual DB column names. Fields without `@map` use the Prisma field name as-is (camelCase). Prefer Prisma query builder over raw SQL.

## Redis + BullMQ

3 queues, auto-started via `instrumentation.ts`:

| Queue | Concurrency | Trigger |
|---|---|---|
| `bot-messages` | 3 | Webhook detects active bot → enqueues instead of blocking |
| `campaign-send` | 1 | Admin clicks "Enviar" on campaign |
| `rag-index` | 2 | User uploads knowledge document |

Workers live in `lib/workers/`. Queue definitions in `lib/queue.ts`. `REDIS_URL` env var required.

## AI providers

Two providers: `openrouter` (OpenAI-compatible SDK, baseURL override) and `google` (native Gemini SDK). API keys stored **per-user** in `AppSettings`, not per-bot. Encrypted with AES-256-GCM (`lib/crypto.ts`).

Provider clients in `lib/ai/providers/`. Factory in `lib/ai/factory.ts`. User's API key resolved via `getUserApiKey(userId, provider)` in `lib/ai/settings.ts`.

Model pricing in `lib/ai/pricing.ts` (USD per 1M tokens). Usage logged per interaction in `WABotUsage`.

RAG: documents chunked → embeddings generated (Gemini or OpenAI via OpenRouter) → stored in pgvector → searched with cosine similarity (`<=>` operator).

## Encryption

AES-256-GCM with random 12-byte IV + 16-byte auth tag. Format: `hex(iv):hex(authTag):hex(ciphertext)`. Key from `ENCRYPTION_KEY` env var (64 hex chars = 32 bytes).

Fields encrypted at rest: `WAAccount.accessToken`, `WAAccount.appSecret`, `AppSettings.openrouterApiKey`, `AppSettings.googleApiKey`.

## Webhook

`POST /api/whatsapp/webhook` handles Meta webhook. Key behaviors:
- Validates `X-Hub-Signature-256` if `appSecret` is set (uses HMAC-SHA256)
- Deduplicates by `wamid` (Meta message ID, stored in `WAMessage.wamid`, unique per chat)
- Detects groups: `remoteJid.includes("@g.us")` → `isGroup = true`
- Status updates look up precise `wamid`, not bulk-update
- After inbound message stored: checks for active bots → `botQueue.add()`

## Design system

All tokens in `app/globals.css` as CSS custom properties. Accent: WhatsApp green (`#25D366` dark, `#1ea952` light).

**Never** write inline button/card/input classes. **Never** use Tailwind color literals. Use semantic tokens: `text-accent`, `bg-surface`, `text-muted`, `text-success`, etc.

Form pattern: `<FormField label="…" error={…}>{(id) => (<Input id={id} … />)}</FormField>`

Toast: `const { success, error } = useToast()` → `success("text")`

## Auth

- `lib/auth.ts` — NextAuth v5 (Credentials + bcrypt, JWT strategy)
- Server: `import { auth } from "@/lib/auth"` → `const session = await auth()`
- Client: `useSession()` from `next-auth/react`
- `Session.user` has `id`, `email`, `name`, `role`
- `SystemConfig` (singleton) controls `allowRegistration` toggle for `/register`
- First registered user gets `role: "admin"`
