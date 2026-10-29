// El OAuth2Client de googleapis lanza un error cuyo mensaje o response.data.error
// contiene "invalid_grant" cuando el usuario revocó el acceso desde su cuenta de
// Google — distinto de un error transitorio de red/API. Compartido por cualquier
// worker que use getGoogleSheetsClientForUser().
export function isRevokedGrantError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const gaxiosCode =
    err && typeof err === "object" && "response" in err
      ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
      : undefined;
  return message.includes("invalid_grant") || gaxiosCode === "invalid_grant";
}

// 403 de Google con "The caller does not have permission" (hoja no compartida
// con la cuenta conectada, o permiso retirado). Es permanente: reintentar cada
// 5 minutos no lo arregla, solo llena el log y gasta cuota. No confundir con
// 403 por rate limit (`rateLimitExceeded`/`userRateLimitExceeded`), que sí es
// transitorio y debe seguir reintentándose.
export function isPermissionDeniedError(err: unknown): boolean {
  const e = err as
    | {
        code?: number | string;
        message?: string;
        response?: {
          status?: number;
          data?: { error?: { status?: string; message?: string; errors?: { reason?: string }[] } };
        };
        cause?: { status?: string; code?: number; message?: string; errors?: { reason?: string }[] };
      }
    | undefined;

  const status =
    e?.response?.status ?? (typeof e?.code === "number" ? e.code : undefined);
  const reason =
    e?.response?.data?.error?.errors?.[0]?.reason ?? e?.cause?.errors?.[0]?.reason;
  const text = [e?.message, e?.response?.data?.error?.message, e?.cause?.message, e?.cause?.status]
    .filter(Boolean)
    .join(" ");

  if (status === 429) return false;
  if (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") return false;
  if (status === 403) return true;
  return /does not have permission|PERMISSION_DENIED/i.test(text);
}
