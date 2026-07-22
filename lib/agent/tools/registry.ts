import type { ToolDefinition } from "./types";
import { contactsList, contactsGet, contactsLeadStatusSet } from "./contacts";
import {
  chatsList, chatsGet, chatsMessagesList,
  chatsTagsAdd, chatsTagsRemove, chatsStatusSet, chatsAssign, chatsAssigneesList,
} from "./chats";
import { botsList, botsGet, botsUsage, botsToggle, botsSystemPromptUpdate, botsDelete } from "./bots";
import { campaignsList, campaignsGet, campaignsRecipientsList, campaignsDelete, campaignsSend } from "./campaigns";
import { templatesList, templatesGet, templatesSync, templatesDelete } from "./templates";
import { scorersList, scorersGet, scorersScoresList, scorersScheduleToggle, scorersDelete } from "./scorers";
import { accountsList, accountsGet, accountsOrigenSet, accountsDelete } from "./accounts";
import {
  sheetSourcesList, sheetSourcesGet, sheetSourcesRowsList,
  sheetSourcesEnabledSet, sheetSourcesDelete, sheetSourcesImportByDate,
} from "./sheet-sources";
import { tagsList } from "./tags";
import { agentBudgetGet } from "./budget";
import { systemDiagnostics } from "./diagnostics";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TOOLS: ToolDefinition<any>[] = [
  // READ
  contactsList, contactsGet,
  chatsList, chatsGet, chatsMessagesList, chatsAssigneesList,
  botsList, botsGet, botsUsage,
  campaignsList, campaignsGet, campaignsRecipientsList,
  templatesList, templatesGet,
  scorersList, scorersGet, scorersScoresList,
  accountsList, accountsGet,
  sheetSourcesList, sheetSourcesGet, sheetSourcesRowsList,
  tagsList,
  agentBudgetGet,
  systemDiagnostics,
  // MINOR
  chatsTagsAdd, chatsTagsRemove, chatsStatusSet, chatsAssign,
  contactsLeadStatusSet,
  accountsOrigenSet,
  templatesSync,
  scorersScheduleToggle,
  // CONFIRM
  accountsDelete,
  botsToggle, botsSystemPromptUpdate, botsDelete,
  scorersDelete,
  sheetSourcesEnabledSet, sheetSourcesDelete, sheetSourcesImportByDate,
  templatesDelete,
  campaignsDelete, campaignsSend,
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name);
}

export function listToolDefinitions() {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}
