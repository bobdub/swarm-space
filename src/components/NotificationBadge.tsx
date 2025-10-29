import { useEffect, useState } from "react";
import { getUnreadCount } from "@/lib/notifications";
import { cn } from "@/lib/utils";

interface NotificationBadgeProps {
  className?: string;
}

export function NotificationBadge({ className }: NotificationBadgeProps) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let isMounted = true;

    const loadCount = async () => {
      const count = await getUnreadCount();
      if (isMounted) {
        setUnreadCount(count);
      }
    };

    void loadCount();

    const handleUpdate = () => {
      void loadCount();
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === "me") {
        void loadCount();
      }
    };

    window.addEventListener("notifications-updated", handleUpdate);
    window.addEventListener("user-login", handleUpdate);
    window.addEventListener("user-logout", handleUpdate);
    window.addEventListener("storage", handleStorageChange);

    // Refresh count every 30 seconds as a fallback
    const interval = setInterval(() => {
      void loadCount();
    }, 30000);

    return () => {
      isMounted = false;
      clearInterval(interval);
      window.removeEventListener("notifications-updated", handleUpdate);
      window.removeEventListener("user-login", handleUpdate);
      window.removeEventListener("user-logout", handleUpdate);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  if (unreadCount === 0) return null;

  return (
    <div
      className={cn(
        "absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(326,71%,62%)] text-[0.6rem] font-bold text-[hsl(253,82%,6%)] shadow-[0_0_15px_hsla(326,71%,62%,0.6)]",
        className
      )}
    >
      {unreadCount > 9 ? "9+" : unreadCount}
    </div>
  );
}
