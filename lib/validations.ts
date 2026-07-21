import { z } from "zod";
import {
  EXPORT_COLUMNS,
  CAMPAIGN_EXPORT_COLUMNS,
  CHATS_EXPORT_COLUMNS,
  CONTACTS_EXPORT_COLUMNS,
} from "@/lib/whatsapp/export-columns";

export const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(1, "La contraseña es requerida"),
});

export const registerSchema = z.object({
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
  email: z.string().email("Email inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

export const onboardingSchema = z.object({
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres"),
  email: z.string().email("Email inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  businessName: z.string().min(2, "El nombre del negocio debe tener al menos 2 caracteres"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Contraseña actual requerida"),
  newPassword: z.string().min(8, "Mínimo 8 caracteres"),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: "Las contraseñas no coinciden",
  path: ["confirmPassword"],
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type OnboardingInput = z.infer<typeof onboardingSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const waAccountSchema = z.object({
  name: z.string().min(1, "El nombre es requerido").max(100),
  phoneNumberId: z.string().min(1, "El Phone Number ID es requerido").regex(/^\d+$/, "Debe ser un ID numérico"),
  accessToken: z.string().min(1, "El token de acceso es requerido"),
  wabaId: z.string().regex(/^\d+$/, "Debe ser un ID numérico").optional().or(z.literal("")),
  appId: z.string().regex(/^\d+$/, "Debe ser un ID numérico").optional().or(z.literal("")),
  verifyToken: z.string().min(6, "El verify token debe tener al menos 6 caracteres").optional().or(z.literal("")),
  appSecret: z.string().optional().or(z.literal("")),
});

export const waAccountUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  accessToken: z.string().min(1).optional(),
  verifyToken: z.string().min(6).optional(),
  appSecret: z.string().optional(),
  wabaId: z.string().optional(),
  appId: z.string().optional(),
});

export const sendMessageSchema = z.object({
  type: z.enum(["text", "image", "audio", "video", "document"]),
  // 4096 es el límite de WhatsApp para texto libre — mejor un 400 claro aquí
  // que un error opaco de la Graph API.
  body: z.string().max(4096, "El mensaje supera el límite de 4096 caracteres de WhatsApp").optional(),
  mediaId: z.string().nullable().optional(),
  caption: z.string().optional(),
  mimeType: z.string().optional(),
  filename: z.string().optional(),
  localMediaPath: z.string().nullable().optional(),
  bytesSize: z.number().optional(),
}).refine(
  (d) => d.type === "text" ? !!d.body : !!d.mediaId || !!d.localMediaPath,
  { message: "Se requiere body para texto, o mediaId/localMediaPath para medios", path: ["body"] }
);

export type WaAccountInput = z.infer<typeof waAccountSchema>;
export type WaAccountUpdateInput = z.infer<typeof waAccountUpdateSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const botSchema = z.object({
  name: z.string().min(1, "El nombre es requerido").max(100),
  waAccountId: z.string().min(1).optional().nullable(),
  provider: z.enum(["openrouter", "google"], { message: "Proveedor inválido" }),
  model: z.string().min(1, "El modelo es requerido"),
  systemPrompt: z.string().min(1, "El prompt del sistema es requerido"),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().min(1).max(8192).optional(),
  memoryType: z.enum(["NONE", "RECENT", "SUMMARY"]).optional(),
  memoryLimit: z.number().min(1).max(100).optional(),
  ragEnabled: z.boolean().optional(),
  humanizeEnabled: z.boolean().optional(),
});

export const botUpdateSchema = botSchema.partial();

export const LEAD_SCORER_SCHEDULE_INTERVALS = [15, 30, 60, 180, 360, 720, 1440] as const;

export const leadScorerBotSchema = z.object({
  name: z.string().min(1, "El nombre es requerido").max(100),
  provider: z.enum(["openrouter", "google"], { message: "Proveedor inválido" }),
  model: z.string().min(1, "El modelo es requerido"),
  systemPrompt: z.string().min(1, "El prompt es requerido"),
  isActive: z.boolean().optional(),
  scheduleEnabled: z.boolean().optional(),
  scheduleIntervalMinutes: z
    .union(LEAD_SCORER_SCHEDULE_INTERVALS.map((n) => z.literal(n)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]])
    .nullable()
    .optional(),
  // Empty/omitted = every account the user owns or has shared with them.
  scheduleAccountIds: z.array(z.string()).optional(),
}).refine(
  (data) => !data.scheduleEnabled || data.scheduleIntervalMinutes != null,
  { message: "Selecciona cada cuánto debe ejecutarse el calificador", path: ["scheduleIntervalMinutes"] }
);

export const leadScorerBotUpdateSchema = z.object({
  name: z.string().min(1, "El nombre es requerido").max(100).optional(),
  provider: z.enum(["openrouter", "google"], { message: "Proveedor inválido" }).optional(),
  model: z.string().min(1, "El modelo es requerido").optional(),
  systemPrompt: z.string().min(1, "El prompt es requerido").optional(),
  isActive: z.boolean().optional(),
  scheduleEnabled: z.boolean().optional(),
  scheduleIntervalMinutes: z
    .union(LEAD_SCORER_SCHEDULE_INTERVALS.map((n) => z.literal(n)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]])
    .nullable()
    .optional(),
  scheduleAccountIds: z.array(z.string()).optional(),
});

export const campaignSchema = z.object({
  name: z.string().min(1, "El nombre es requerido").max(200),
  waAccountId: z.string().min(1, "La cuenta es requerida"),
  waTemplateId: z.string().min(1, "La plantilla es requerida"),
  scheduledAt: z.string().datetime().optional().nullable(),
  headerParam: z.string().optional(),
  buttonParam: z.string().optional(),
  recipients: z.array(z.object({
    phoneNumber: z.string().min(1, "El número es requerido").regex(/^\d+$/, "Debe ser numérico"),
    contactName: z.string().optional(),
    parameters: z.record(z.string(), z.string()).optional(),
  })).min(1, "Al menos un destinatario es requerido"),
});

export const leadSheetSourceSchema = z.object({
  name: z.string().min(1, "El nombre es requerido").max(200),
  waAccountId: z.string().min(1, "La cuenta es requerida"),
  waTemplateId: z.string().min(1, "La plantilla es requerida"),
  spreadsheetId: z.string().min(1, "La hoja de Google Sheets es requerida"),
  sheetName: z.string().min(1, "La pestaña es requerida"),
  phoneColumn: z.string().min(1, "La columna de teléfono es requerida"),
  nameColumn: z.string().optional(),
  dateColumn: z.string().optional(),
  bodyColumns: z.array(z.string()).default([]),
  headerParam: z.string().optional(),
  buttonParam: z.string().optional(),
  // Rotación round-robin: índice (0-based) de la variable del body que rota y la
  // lista de valores. Se exigen al menos 2 valores — con uno solo no hay rotación.
  rotatingParamIndex: z.number().int().min(0).nullable().optional(),
  rotatingValues: z.array(z.string().min(1).max(200)).max(50).default([]),
}).refine(
  (d) => d.rotatingParamIndex == null || d.rotatingValues.filter(Boolean).length >= 2,
  { message: "La rotación necesita al menos 2 valores", path: ["rotatingValues"] }
);

export const leadSheetSourceUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  headerParam: z.string().nullable().optional(),
  buttonParam: z.string().nullable().optional(),
  rotatingValues: z.array(z.string().min(1).max(200)).max(50).optional(),
});

export type BotInput = z.infer<typeof botSchema>;
export type BotUpdateInput = z.infer<typeof botUpdateSchema>;
export type LeadScorerBotInput = z.infer<typeof leadScorerBotSchema>;
export type LeadScorerBotUpdateInput = z.infer<typeof leadScorerBotUpdateSchema>;
export type CampaignInput = z.infer<typeof campaignSchema>;
export type LeadSheetSourceInput = z.infer<typeof leadSheetSourceSchema>;
export type LeadSheetSourceUpdateInput = z.infer<typeof leadSheetSourceUpdateSchema>;

const headerFormatEnum = z.enum(["TEXT", "IMAGE", "VIDEO", "DOCUMENT"]);
const buttonTypeEnum = z.enum(["QUICK_REPLY", "URL"]);

export const templateCreateSchema = z.object({
  waAccountId: z.string().min(1, "La cuenta es requerida"),
  name: z.string()
    .min(1, "El nombre es requerido")
    .max(512, "El nombre es demasiado largo")
    .regex(/^[a-z][a-z0-9_]*$/, "Solo minúsculas, números y guiones bajos (debe empezar con letra)"),
  language: z.string().min(2, "El idioma es requerido").max(5).default("es"),
  components: z.object({
    header: z.object({
      format: headerFormatEnum,
      text: z.string().optional(),
      // A Resumable Upload API handle (lib/whatsapp/resumable-upload.ts), not a URL —
      // Meta requires binary media uploaded through that flow for template creation.
      exampleHandle: z.string().optional(),
    }).optional(),
    body: z.string().min(1, "El cuerpo es requerido").max(1024, "El cuerpo es demasiado largo"),
    // Meta requires one example value per {{n}} variable in the body — without
    // it the Graph API rejects template creation (error 132000).
    bodyExamples: z.array(z.string().min(1, "Ejemplo requerido")).optional(),
    footer: z.string().max(60, "Máximo 60 caracteres").optional(),
    buttons: z.array(z.object({
      type: buttonTypeEnum,
      text: z.string().min(1, "Texto requerido").max(25, "Máximo 25 caracteres"),
      url: z.string().url("URL inválida").optional(),
    })).max(10, "Máximo 10 botones").optional(),
  }),
});

export type TemplateCreateInput = z.infer<typeof templateCreateSchema>;

export const contactUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  leadStatus: z.enum(["NEW", "CONTACTED", "QUALIFIED", "CUSTOMER", "LOST"]).optional(),
});

export const noteSchema = z.object({
  body: z.string().min(1, "La nota no puede estar vacía").max(2000, "Máximo 2000 caracteres"),
});

export const tagSchema = z.object({
  name: z.string().min(1, "El nombre es requerido").max(50),
  color: z.string().max(30).optional(),
});

export const cannedResponseSchema = z.object({
  waAccountId: z.string().min(1, "La cuenta es requerida"),
  shortcut: z
    .string()
    .min(1, "El atajo es requerido")
    .max(40)
    .regex(/^\S+$/, "El atajo no puede contener espacios")
    .transform((v) => v.toLowerCase().replace(/^\/+/, "")),
  content: z.string().min(1, "El contenido es requerido").max(2000),
});

export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;
export type NoteInput = z.infer<typeof noteSchema>;
export type TagInput = z.infer<typeof tagSchema>;
export type CannedResponseInput = z.infer<typeof cannedResponseSchema>;

// Exportaciones configurables a Google Sheets (ver SheetExport en schema.prisma).
// `filters` cambia de forma según `dataset` — un z.discriminatedUnion (primera vez
// en este archivo) es más seguro que un .refine() a mano sobre 4 formas genuinamente
// distintas, que es el patrón usado en el resto del archivo (ver leadSheetSourceSchema).
function columnKeysEnum(defs: { key: string }[]) {
  return z.enum(defs.map((d) => d.key) as [string, ...string[]]);
}

const leadScoresColumnEnum = columnKeysEnum(EXPORT_COLUMNS);
const campaignResultsColumnEnum = columnKeysEnum(CAMPAIGN_EXPORT_COLUMNS);
const chatsColumnEnum = columnKeysEnum(CHATS_EXPORT_COLUMNS);
const contactsColumnEnum = columnKeysEnum(CONTACTS_EXPORT_COLUMNS);

// Los arrays de filtro solo aceptan `undefined` (= "sin filtro, todo lo accesible")
// u omitidos con al menos 1 elemento — un `[]` explícito se rechaza (.min(1)) para
// no producir "0 filas" en silencio por un error del cliente.
const leadScoresFiltersSchema = z.object({
  accountIds: z.array(z.string().min(1)).min(1).optional(),
  scorerIds: z.array(z.string().min(1)).min(1).optional(),
  labels: z.array(z.string().min(1)).min(1).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
}).default({});

const campaignResultsFiltersSchema = z.object({
  accountIds: z.array(z.string().min(1)).min(1).optional(),
  // Ids de WACampaign (origen manual) y/o LeadSheetSource (automatización)
  // mezclados — ver lib/google/dataset-queries.ts:buildCampaignResultRows.
  campaignIds: z.array(z.string().min(1)).min(1).optional(),
  origins: z.array(z.enum(["manual", "automatizacion"])).min(1).optional(),
  statuses: z.array(z.enum(["PENDING", "SENT", "DELIVERED", "READ", "FAILED", "SKIPPED"])).min(1).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
}).default({});

const chatsFiltersSchema = z.object({
  accountIds: z.array(z.string().min(1)).min(1).optional(),
  statuses: z.array(z.enum(["OPEN", "PENDING", "RESOLVED"])).min(1).optional(),
  tagIds: z.array(z.string().min(1)).min(1).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
}).default({});

const contactsFiltersSchema = z.object({
  accountIds: z.array(z.string().min(1)).min(1).optional(),
  tagIds: z.array(z.string().min(1)).min(1).optional(),
  leadStatuses: z.array(z.enum(["NEW", "CONTACTED", "QUALIFIED", "CUSTOMER", "LOST"])).min(1).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
}).default({});

export const SHEET_EXPORT_FILTERS_SCHEMAS = {
  LEAD_SCORES: leadScoresFiltersSchema,
  CAMPAIGN_RESULTS: campaignResultsFiltersSchema,
  CHATS: chatsFiltersSchema,
  CONTACTS: contactsFiltersSchema,
} as const;

const sheetExportBaseFields = {
  name: z.string().min(1, "El nombre es requerido").max(200),
  // Id ya extraído por el cliente vía /preview (mismo patrón que leadSheetSourceSchema),
  // no una URL cruda.
  spreadsheetId: z.string().min(1, "La hoja de Google Sheets es requerida"),
  sheetName: z.string().min(1, "La pestaña es requerida"),
};

export const sheetExportCreateSchema = z.discriminatedUnion("dataset", [
  z.object({
    ...sheetExportBaseFields,
    dataset: z.literal("LEAD_SCORES"),
    columns: z.array(leadScoresColumnEnum).min(1, "Elige al menos una columna"),
    filters: leadScoresFiltersSchema,
  }),
  z.object({
    ...sheetExportBaseFields,
    dataset: z.literal("CAMPAIGN_RESULTS"),
    columns: z.array(campaignResultsColumnEnum).min(1, "Elige al menos una columna"),
    filters: campaignResultsFiltersSchema,
  }),
  z.object({
    ...sheetExportBaseFields,
    dataset: z.literal("CHATS"),
    columns: z.array(chatsColumnEnum).min(1, "Elige al menos una columna"),
    filters: chatsFiltersSchema,
  }),
  z.object({
    ...sheetExportBaseFields,
    dataset: z.literal("CONTACTS"),
    columns: z.array(contactsColumnEnum).min(1, "Elige al menos una columna"),
    filters: contactsFiltersSchema,
  }),
]);

// `dataset` es inmutable tras crear — cambiarlo invalidaría columns/filters
// enteros, así que no es un discriminated union: para cambiar de dataset se
// borra y se crea otro. `filters`/`columns` se revalidan en la ruta contra
// `existing.dataset` (SHEET_EXPORT_FILTERS_SCHEMAS / EXPORT_COLUMNS_BY_DATASET),
// no aquí — este schema solo valida la forma superficial.
export const sheetExportUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  spreadsheetId: z.string().min(1).optional(),
  sheetName: z.string().min(1).optional(),
  columns: z.array(z.string().min(1)).min(1, "Elige al menos una columna").optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export type SheetExportCreateInput = z.infer<typeof sheetExportCreateSchema>;
export type SheetExportUpdateInput = z.infer<typeof sheetExportUpdateSchema>;

// Tope explícito (no silencioso) — el modal avisa en la UI si se seleccionan
// más de 50 chats en vez de dejar que el usuario mande un lote gigante de un
// jalón contra el proveedor de IA y la Graph API de Meta.
export const unassignedLeadReplySchema = z.object({
  botId: z.string().min(1),
  chatIds: z.array(z.string().min(1)).min(1, "Selecciona al menos un chat").max(50, "Máximo 50 chats por envío"),
});

export type UnassignedLeadReplyInput = z.infer<typeof unassignedLeadReplySchema>;
