// Id-based merge keeps already-loaded history while refreshing delivery state.
export function mergeChatMessages<T extends { id: string; timestamp: string }>(previous: T[], incoming: T[]): T[] {
  const byId = new Map(previous.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
}

export function mergeChatPages<T extends { id: string }>(pages: T[][]): T[] {
  return [...new Map(pages.flat().map((item) => [item.id, item])).values()];
}
