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
