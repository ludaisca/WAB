// Errores compartidos por las funciones extraídas a lib/ (Fase 0 del agente de
// IA) — permiten que tanto las rutas HTTP como el registry de tools del agente
// mapeen el mismo fallo a su propia representación (status HTTP vs. resultado
// de tool) sin duplicar el criterio de qué es "no encontrado" vs. "inválido".
export class NotFoundError extends Error {}
export class ValidationError extends Error {}
