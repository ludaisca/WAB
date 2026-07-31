# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

WAB is a WhatsApp Business CRM built on Meta's official Cloud API: real-time chat inbox, multimodal AI reply bots, automatic lead scoring, template-based mass campaigns, abandoned-lead recovery, and Google Sheets sync — with role-based access control and multi-account/multi-number support.

@AGENTS.md

## Commands

Everything runs in Docker — never install dependencies or run Node/Postgres/Redis on the host.

**This checkout is a remote FUSE mount of `/mnt/datos/Proyectos/WAB` on `rocky-server` (SSH, passwordless) — edit files locally as usual, but run every command below over SSH, prefixed with `ssh rocky-server "cd /mnt/datos/Proyectos/WAB && ..."`.** Local `docker compose` fails here (no daemon, and bind-mounts break over the FUSE layer); the real stack (with real data) only runs on `rocky-server`. See "Development" in AGENTS.md for the full explanation.

```bash
docker compose up --build                      # start dev stack (app + postgres + redis), hot reload on :17100
docker compose exec app npx tsc --noEmit        # type check
docker compose exec app npm run lint            # eslint (flat config, eslint-config-next)
docker compose exec app npm run build           # production build check (also type-checks)
docker compose exec app npx prisma db push      # apply schema.prisma changes to the dev DB
docker compose exec app npx prisma generate     # regenerate Prisma client after schema changes
docker compose restart app                      # required after db push — see "Dev container needs a restart" gotcha in AGENTS.md
```

There is no automated test suite in this repo (no test script in `package.json`) — verification is `tsc --noEmit` + `npm run lint` + `npm run build`, plus manual click-through for UI changes.

To run a single check against one file, use `npx tsc --noEmit` (whole-project, TS has no single-file mode that respects path aliases) or `npx eslint <path>` for a targeted lint pass.
