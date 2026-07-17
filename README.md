# WAB — WhatsApp Business CRM

CRM de WhatsApp Business construido sobre la API oficial de Meta (Cloud API): bandeja de chats en tiempo real, bots de IA multimodales, calificación automática de leads, campañas masivas por plantilla, recuperación de leads abandonados y sincronización con Google Sheets — todo con control de acceso por rol y soporte multi-cuenta/multi-número.

## Funcionalidad principal

- **Chats**: bandeja estilo inbox con filtros (cuenta, campaña, respondido/no respondido), asignación de agentes, notas internas, etiquetas, respuestas rápidas (`/atajo`), adjuntos multimedia (imagen/audio/video/documento/sticker) con proxy seguro de medios.
- **Bots de IA**: respuestas automáticas multimodales (OpenRouter o Google Gemini), con RAG sobre una base de conocimiento propia (pgvector), humanización de respuestas (envío fraccionado con delay simulado) y presupuesto mensual de gasto en IA.
- **Calificadores de leads**: un bot de IA aparte audita cada conversación y la puntúa (0–100) en un embudo de 5 fases, con ejecución manual o programada, detección de spam/venta inversa, y exportación a CSV o a una hoja de Google sincronizada automáticamente.
- **Recuperación de leads**: reengancha automáticamente conversaciones "en visto" dentro de la ventana de 24h de WhatsApp, respetando horario laboral configurado por el usuario.
- **Campañas**: envío masivo por plantilla aprobada de Meta, con importación de destinatarios por CSV, variables por destinatario, programación y métricas de entrega/lectura.
- **Plantillas**: creación y sincronización con la API de plantillas de Meta, incluyendo headers con media vía la Resumable Upload API.
- **Multi-cuenta**: cada número de WhatsApp (`WAAccount`) es independiente (su propia app de Meta, credenciales y webhook), con la opción de compartir una cuenta entre usuarios.
- **Roles**: `admin`, `user` y `ejecutivo`, cada uno con su propia navegación y permisos aplicados tanto en middleware como en cada endpoint.
- **Google Sheets**: conexión OAuth por usuario que mantiene una hoja actualizada con leads calificados y resultados de campaña.

## Stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack) + [Tailwind CSS v4](https://tailwindcss.com)
- [NextAuth v5](https://authjs.dev) (Credentials + JWT)
- [Prisma 5](https://www.prisma.io) sobre PostgreSQL + [pgvector](https://github.com/pgvector/pgvector)
- [Redis](https://redis.io) + [BullMQ](https://docs.bullmq.io) para colas de trabajo asíncronas
- React 19, `openai` SDK (OpenRouter), `@google/generative-ai`, `googleapis`

## Desarrollo

Todo corre en Docker — no se instalan dependencias ni bases de datos en el host.

```bash
cp .env.example .env        # completa las variables (ver abajo)
docker compose up --build   # app + postgres + redis, hot reload en :3001
```

Comandos útiles dentro del contenedor:

```bash
docker compose exec app npx tsc --noEmit     # type check
docker compose exec app npm run lint         # eslint
docker compose exec app npm run build        # build de producción (ver nota abajo)
docker compose exec app npx prisma db push   # aplicar cambios de schema.prisma
docker compose restart app                   # requerido tras un db push
```

No hay suite de tests automatizada — la verificación es `tsc --noEmit` + `lint` + `build`, más pruebas manuales en el navegador.

### Variables de entorno

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | conexión a PostgreSQL |
| `REDIS_URL` | conexión a Redis |
| `AUTH_SECRET` | secreto de NextAuth (`openssl rand -base64 32`) |
| `ENCRYPTION_KEY` | clave AES-256 para credenciales cifradas en DB (`openssl rand -hex 32`) |
| `NEXT_PUBLIC_APP_URL` | URL pública de la app |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI` | credenciales OAuth para la sincronización con Google Sheets (opcional) |
| `MEDIA_ROOT` | directorio de medios descargados (default `/app/media`) |
| `MEDIA_RETENTION_DAYS` | días antes de purgar medios viejos (default 90, `0` desactiva) |

Las credenciales de cada número de WhatsApp (token de acceso, App Secret, etc.) y las API keys de IA se configuran desde la propia app, no por variable de entorno — quedan cifradas en la base de datos.

## Arquitectura

- `app/` — rutas de Next.js App Router: `(auth)` (login/registro), `(dashboard)` (la app autenticada) y `api/` (endpoints REST).
- `lib/` — lógica de dominio agrupada por área: `ai/` (proveedores de IA, RAG, presupuesto), `whatsapp/` (ingesta de mensajes, envío, plantillas, calificación de leads, recuperación), `google/` (OAuth y sincronización con Sheets), `workers/` (procesadores de las colas BullMQ), más utilidades transversales (`crypto.ts`, `rate-limit.ts`, `shared-accounts.ts`).
- `prisma/` — schema y utilidades SQL (índice vectorial de pgvector).
- `docker/` — inicialización de PostgreSQL (extensión pgvector).
- `scripts/` — script de arranque de producción (`migrate deploy`/`db push` + servidor).

Para el detalle de convenciones, gotchas y decisiones de arquitectura, ver [`AGENTS.md`](./AGENTS.md).

## Despliegue

Pensado para desplegarse vía [Coolify](https://coolify.io) u otra plataforma compatible con `docker-compose.yml`. El servicio de la app corre sin puerto fijo expuesto (`expose: 5000`) — el proxy de la plataforma (ej. Traefik) enruta por dominio.
