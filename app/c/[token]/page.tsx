import type { Metadata } from "next";
import { Link2Off } from "lucide-react";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PublicChatView } from "@/app/components/whatsapp/public-chat-view";
import { getPublicChatData } from "@/lib/whatsapp/public-chat-data";

// noindex: es una URL con un secreto en el path (el token) — nunca debe
// terminar en un índice de buscador ni en un preview de link con caché.
export const metadata: Metadata = {
  title: "Conversación — vista pública",
  robots: { index: false, follow: false },
};

export default async function PublicChatPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await getPublicChatData(token);

  if (!data) {
    return (
      <div className="max-w-md mx-auto min-h-dvh flex items-center justify-center px-4">
        <EmptyState
          icon={Link2Off}
          title="Este link no es válido"
          description="El link fue revocado o nunca existió. Pide uno nuevo a quien te lo compartió."
        />
      </div>
    );
  }

  return <PublicChatView token={token} data={data} />;
}
