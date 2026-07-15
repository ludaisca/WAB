import { z } from "zod";

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
  body: z.string().optional(),
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

export type BotInput = z.infer<typeof botSchema>;
export type BotUpdateInput = z.infer<typeof botUpdateSchema>;
export type LeadScorerBotInput = z.infer<typeof leadScorerBotSchema>;
export type LeadScorerBotUpdateInput = z.infer<typeof leadScorerBotUpdateSchema>;
export type CampaignInput = z.infer<typeof campaignSchema>;

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
