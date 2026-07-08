# AGENTS.md

## Stack
- **Next.js 16** (App Router) + **Tailwind CSS v4** (CSS-based, no config file)
- **NextAuth v5** beta (Credentials + JWT, Prisma adapter)
- **Prisma 5** (PostgreSQL)
- React 19, lucide-react, zod, bcryptjs, next-themes

## Framework quirks
- `proxy.ts` is the middleware (Next.js 16 uses it instead of `middleware.ts`)
- `params` in page props is a `Promise<>` — must `await` before destructuring
- `rm -rf .next` after structural file changes (stale Turbopack cache causes 404s/500s)

## Commands
```bash
npm run dev      # next dev -H 0.0.0.0 -p 5000
npm run build    # next build
npx tsc --noEmit # type check
npx prisma db push      # sync schema → DB (dev)
npx prisma generate     # after schema changes
npx prisma migrate dev  # production migrations
```

## Paths
`@/*` maps to `./*` in `tsconfig.json`.

## Design system
All tokens are CSS custom properties in `app/globals.css` with Tailwind v4 `@theme inline`. Dark by default, togglable via `next-themes` (`class` strategy, `.light` class).

**Rules:**
- **Never** write inline button/card/input classes — use primitives from `app/components/ui/`
- **Never** use Tailwind color literals (`text-red-500`, `bg-blue-100`) — use semantic tokens: `text-accent`, `bg-surface`, `text-muted`, `text-success`, `text-danger`, `text-info`, `text-warning`, `text-on-accent`, `bg-surface-light`, `bg-success-bg`, etc.

**Key primitives:** `Button`, `Card` (+ `CardHeader/Title/Body/Footer`), `Input`, `Select`, `Textarea`, `FormField`, `Badge`, `Banner`, `Alert`, `Modal`, `Drawer`, `ConfirmDialog`, `Toast`/`useToast`, `IconBox`, `Spinner`, `Skeleton`, `EmptyState`, `StatCard`, `Progress`, `Switch`, `Checkbox`, `RadioGroup`, `FileInput`, `DatePicker`, `MultiSelect`, `Pagination`, `Breadcrumb`, `Avatar`, `Dropdown` (+ `DropdownItem/Divider/Button`), `PasswordInput`, `PasswordStrength`, `Logo`, `UserDropdown`, `AppShell`, `ThemeToggle`

**Form pattern:** Always wrap inputs in `<FormField label="…" required error={…}>{(id, describedBy) => (<Input id={id} … />)}</FormField>` for automatic label/id/aria wiring.

**Toast:** `const { success, error, warning, info } = useToast()` → call `success("mensaje")` for feedback.

## Auth
- `lib/auth.ts` — NextAuth v5 config (Credentials + bcrypt, JWT strategy)
- `proxy.ts` — protects `/dashboard`, `/examples`, `/configuracion`; redirects logged-in users away from `/login`, `/register`
- `Session.user` includes: `id`, `email`, `name`, `role`
- Server components: `import { auth } from "@/lib/auth"` → `const session = await auth()`
- Client components: `useSession()` from `next-auth/react`

## Project structure
```
app/
  components/ui/       # 30+ design system primitives
  (auth)/              # /login, /register — centered card layout
  (dashboard)/         # protected routes (proxy.ts checks session)
    dashboard-shell.tsx # builds nav array client-side, renders <AppShell>
    dashboard/         # home page
    examples/          # table + form demos
    configuracion/     # user settings
  api/auth/            # NextAuth handler + register endpoint
lib/                   # auth.ts, prisma.ts, validations.ts (zod)
prisma/                # schema.prisma (User model)
```

## Navigation
Sidebar nav defined in `app/(dashboard)/dashboard-shell.tsx`. Add `<NavItem>` objects to the `NAV` array. Icons are Lucide components passed as `icon: React.ElementType`.
