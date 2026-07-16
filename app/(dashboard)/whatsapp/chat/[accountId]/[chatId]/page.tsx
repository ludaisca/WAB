"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ChatWorkspace } from "@/app/components/whatsapp/chat-workspace";
import { Spinner } from "@/app/components/ui/spinner";

function ChatDetailPageContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const accountId = params.accountId as string;
  const chatId = params.chatId as string;
  const campaignId = searchParams.get("campaignId") || undefined;
  const hasReplied = searchParams.get("hasReplied");
  const search = searchParams.get("search") || undefined;

  return (
    <ChatWorkspace
      initialAccountId={accountId}
      initialChatId={chatId}
      initialCampaignId={campaignId}
      initialHasReplied={hasReplied === "yes" || hasReplied === "no" ? hasReplied : ""}
      initialSearch={search}
    />
  );
}

export default function ChatDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16">
          <Spinner />
        </div>
      }
    >
      <ChatDetailPageContent />
    </Suspense>
  );
}
