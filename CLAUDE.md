# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

Everything runs in Docker — never install dependencies or run Node/Postgres/Redis on the host.

```bash
docker compose up --build                      # start dev stack (app + postgres + redis), hot reload on :3001
docker compose exec app npx tsc --noEmit        # type check
docker compose exec app npm run lint            # eslint (flat config, eslint-config-next)
docker compose exec app npm run build           # production build check (also type-checks)
docker compose exec app npx prisma db push      # apply schema.prisma changes to the dev DB
docker compose exec app npx prisma generate     # regenerate Prisma client after schema changes
docker compose restart app                      # required after db push — see "Dev container needs a restart" gotcha in AGENTS.md
```

There is no automated test suite in this repo (no test script in `package.json`) — verification is `tsc --noEmit` + `npm run lint` + `npm run build`, plus manual click-through for UI changes.

To run a single check against one file, use `npx tsc --noEmit` (whole-project, TS has no single-file mode that respects path aliases) or `npx eslint <path>` for a targeted lint pass.
