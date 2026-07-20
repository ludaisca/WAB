"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ChatWorkspace } from "@/app/components/whatsapp/chat-workspace";
import { SkeletonChatList } from "@/app/components/ui/skeleton";

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
        <div className="w-full max-w-sm p-3">
          <SkeletonChatList rows={7} />
        </div>
      }
    >
      <ChatDetailPageContent />
    </Suspense>
  );
}
