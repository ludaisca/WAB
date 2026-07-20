"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ChatWorkspace } from "@/app/components/whatsapp/chat-workspace";
import { SkeletonChatList } from "@/app/components/ui/skeleton";

function ChatPageContent() {
  const searchParams = useSearchParams();
  const accountId = searchParams.get("accountId") || undefined;
  const campaignId = searchParams.get("campaignId") || undefined;
  const hasReplied = searchParams.get("hasReplied");
  const search = searchParams.get("search") || undefined;

  return (
    <ChatWorkspace
      initialAccountId={accountId}
      initialCampaignId={campaignId}
      initialHasReplied={hasReplied === "yes" || hasReplied === "no" ? hasReplied : ""}
      initialSearch={search}
    />
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-sm p-3">
          <SkeletonChatList rows={7} />
        </div>
      }
    >
      <ChatPageContent />
    </Suspense>
  );
}
