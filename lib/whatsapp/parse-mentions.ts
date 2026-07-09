import type { Assignee } from "@/lib/chat-assignees";

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * Extrae menciones @nombre / @email de un texto y las resuelve contra la
 * lista de candidatos elegibles de la cuenta. Menciones que no matchean
 * ningún candidato se ignoran silenciosamente.
 */
export function extractMentions(body: string, candidates: Assignee[]): Assignee[] {
  const matches = body.match(/@([\w.-]+)/g) ?? [];
  if (matches.length === 0) return [];

  const mentioned: Assignee[] = [];
  for (const match of matches) {
    const handle = normalize(match.slice(1));
    const candidate = candidates.find(
      (c) =>
        (c.name && normalize(c.name) === handle) ||
        normalize(c.email.split("@")[0]) === handle
    );
    if (candidate && !mentioned.some((m) => m.id === candidate.id)) {
      mentioned.push(candidate);
    }
  }
  return mentioned;
}
