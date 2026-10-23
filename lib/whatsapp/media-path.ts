import path from "node:path";

// Los archivos generados por media-store siempre son cuenta/nombre.ext.
// No basta con mantenerlos dentro de MEDIA_ROOT: deben ser de ESTA cuenta.
export function assertAccountMediaPath(accountId: string, relativePath: string): void {
  const parts = relativePath.split("/");
  if (parts.length !== 2 || parts[0] !== accountId || !parts[1] ||
      parts.some((part) => part === "." || part === "..") ||
      /[\\\0]/.test(relativePath) || path.posix.normalize(relativePath) !== relativePath) {
    throw new Error("El archivo no pertenece a esta cuenta");
  }
}
