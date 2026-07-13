"use client";

import { useParams } from "next/navigation";
import { ChatWorkspace } from "@/app/components/whatsapp/chat-workspace";

export default function ChatDetailPage() {
  const params = useParams();
  const accountId = params.accountId as string;
  const chatId = params.chatId as string;

  return <ChatWorkspace initialAccountId={accountId} initialChatId={chatId} />;
}
