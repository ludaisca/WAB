// Validador mínimo contra el subset de JSON Schema que usan los tools del
// agente (type:"object" con properties planas: string/number/boolean/array,
// enum opcional, required[]) — no hace falta una librería completa (ajv) para
// este subset, y ya evita que argumentos mal formados de un modelo lleguen a
// un handler de tool.
interface JsonSchemaProp {
  type?: string;
  enum?: unknown[];
}

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
}

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; error: string };

function typeMatches(value: unknown, type: string | undefined): boolean {
  if (!type) return true;
  // `null` explícito en un campo opcional (ej. "desasignar" pasando assignedToId:null)
  // es una señal deliberada de "sin valor" — nuestro subset de JSON Schema no declara
  // uniones de tipo (["string","null"]) para esto, así que null siempre pasa aquí;
  // el propio handler decide qué hacer con él.
  if (value === null) return true;
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

export function validateAgainstJsonSchema<T = Record<string, unknown>>(
  schema: Record<string, unknown>,
  data: unknown
): ValidationResult<T> {
  const s = schema as JsonSchema;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, error: "Los argumentos del tool deben ser un objeto" };
  }
  const obj = data as Record<string, unknown>;

  for (const key of s.required ?? []) {
    if (!(key in obj) || obj[key] === undefined || obj[key] === null) {
      return { ok: false, error: `Falta el argumento requerido "${key}"` };
    }
  }

  const properties = s.properties ?? {};
  for (const [key, value] of Object.entries(obj)) {
    const propSchema = properties[key];
    if (!propSchema) continue; // sin `additionalProperties:false` en v1 — se ignora lo extra
    if (!typeMatches(value, propSchema.type)) {
      return { ok: false, error: `El argumento "${key}" debe ser de tipo ${propSchema.type}` };
    }
    if (propSchema.enum && !propSchema.enum.includes(value)) {
      return { ok: false, error: `El argumento "${key}" debe ser uno de: ${propSchema.enum.join(", ")}` };
    }
  }

  return { ok: true, data: obj as T };
}
