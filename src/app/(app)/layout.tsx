import { BottomNav } from "@/components/bottom-nav";
import { requireUser } from "@/lib/auth";
import { getUnreadConversationCount } from "@/lib/message-unread";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const unreadConversationCount = await getUnreadConversationCount(user.id);
  return (
    <>
      {children}
      <BottomNav unreadConversationCount={unreadConversationCount} />
    </>
  );
}
