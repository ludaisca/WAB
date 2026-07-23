export interface PgConnectionInfo {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

// La password nunca se pasa por argv a pg_dump/pg_restore (quedaría visible en
// /proc/<pid>/cmdline de cualquier proceso con acceso al contenedor) — se
// inyecta vía PGPASSWORD en el env del child process, ver create-backup.ts /
// restore-backup.ts.
export function parseDatabaseUrl(): PgConnectionInfo {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL no está configurada");

  const url = new URL(raw);
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
  };
}
