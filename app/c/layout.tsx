// Layout deliberadamente sin DashboardShell: /c/[token] es la vista pública
// de solo lectura de un chat (sin login, sin sidebar, sin ninguna navegación
// hacia el resto de la app) — ver lib/whatsapp/chat-public-link.ts.
export default function PublicChatLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-background">{children}</div>;
}
