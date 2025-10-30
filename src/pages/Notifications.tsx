import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, Heart, MessageCircle, User as UserIcon, Check } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getNotifications, markAsRead, markAllAsRead } from "@/lib/notifications";
import { Notification } from "@/types";
import { formatDistanceToNow } from "date-fns";
import { Avatar } from "@/components/Avatar";
import { Link } from "react-router-dom";
import { toast } from "@/hooks/use-toast";

const Notifications = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadNotifications = useCallback(async () => {
    setIsLoading(true);
    try {
      const notifs = await getNotifications();
      setNotifications(notifs);
    } catch (error) {
      console.error("Failed to load notifications:", error);
      toast({
        title: "Error",
        description: "Failed to load notifications",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotifications();

    const handleUpdate = () => {
      void loadNotifications();
    };

    window.addEventListener("notifications-updated", handleUpdate);
    return () => window.removeEventListener("notifications-updated", handleUpdate);
  }, [loadNotifications]);

  const handleMarkAsRead = async (notificationId: string) => {
    await markAsRead(notificationId);
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
    );
  };

  const handleMarkAllAsRead = async () => {
    await markAllAsRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    toast({
      title: "All notifications marked as read",
    });
  };

  const getNotificationIcon = (type: Notification["type"], emoji?: string) => {
    switch (type) {
      case "reaction":
        return <span className="text-xl">{emoji || "❤️"}</span>;
      case "comment":
        return <MessageCircle className="h-4 w-4 text-[hsl(174,59%,56%)]" />;
      case "follow":
        return <UserIcon className="h-4 w-4 text-[hsl(326,71%,62%)]" />;
      default:
        return <Bell className="h-4 w-4 text-foreground/60" />;
    }
  };

  const getNotificationMessage = (notif: Notification) => {
    switch (notif.type) {
      case "reaction":
        return (
          <>
            <span className="font-semibold text-[hsl(326,71%,62%)]">{notif.triggeredByName}</span> reacted {notif.emoji} to your post
          </>
        );
      case "comment":
        return (
          <>
            <span className="font-semibold text-[hsl(326,71%,62%)]">{notif.triggeredByName}</span> commented on your post
            {notif.content && (
              <span className="block mt-1 text-sm text-foreground/60 italic">"{notif.content}"</span>
            )}
          </>
        );
      case "follow":
        return (
          <>
            <span className="font-semibold text-[hsl(326,71%,62%)]">{notif.triggeredByName}</span> started following you
          </>
        );
      default:
        return notif.content || "New notification";
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="min-h-screen">
      <TopNavigationBar />
      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-3 pb-20 pt-10 md:px-6">
        <header className="flex flex-col gap-4 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
          <h1 className="text-3xl font-bold font-display uppercase tracking-wider">
            Notifications
            {unreadCount > 0 && (
              <span className="ml-3 text-sm font-normal text-[hsl(326,71%,62%)]">
                ({unreadCount} unread)
              </span>
            )}
          </h1>
          {unreadCount > 0 && (
            <Button onClick={handleMarkAllAsRead} variant="outline" size="sm" className="gap-2">
              <Check className="h-4 w-4" />
              Mark all as read
            </Button>
          )}
        </header>

        <section className="space-y-6">
          {isLoading ? (
            <Card className="rounded-3xl border border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.45)] p-8 text-center">
              <div className="animate-pulse">
                <Bell className="mx-auto mb-3 h-10 w-10 text-[hsl(174,59%,56%)]/70" />
                <p className="text-sm text-foreground/70">Loading notifications...</p>
              </div>
            </Card>
          ) : notifications.length === 0 ? (
            <Card className="rounded-3xl border border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.45)] p-12 text-center">
              <Bell className="mx-auto mb-4 h-12 w-12 text-[hsl(174,59%,56%)] opacity-50" />
              <p className="text-foreground/60">No notifications yet</p>
              <p className="mt-2 text-sm text-foreground/40">
                You'll see reactions, comments, and other interactions here
              </p>
            </Card>
          ) : (
            <div className="space-y-4">
              {notifications.map((notif) => (
                <Card
                  key={notif.id}
                  className={`rounded-3xl border transition-all duration-200 hover:border-[hsla(326,71%,62%,0.3)] ${
                    notif.read
                      ? "border-[hsla(174,59%,56%,0.14)] bg-[hsla(245,70%,8%,0.45)]"
                      : "border-[hsla(326,71%,62%,0.35)] bg-[hsla(245,70%,12%,0.6)] shadow-[0_0_28px_hsla(326,71%,62%,0.2)]"
                  }`}
                >
                  <div className="flex gap-4 p-4">
                    <Avatar username={notif.triggeredByName} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm leading-relaxed text-foreground/90">
                          {getNotificationMessage(notif)}
                        </p>
                        <div className="flex shrink-0 items-center gap-2">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,8%,0.6)]">
                            {getNotificationIcon(notif.type, notif.emoji)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <span className="font-display text-xs uppercase tracking-wider text-foreground/50">
                          {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                        </span>
                        {!notif.read && (
                          <Button
                            onClick={() => handleMarkAsRead(notif.id)}
                            variant="ghost"
                            size="sm"
                            className="h-7 px-3 text-xs text-[hsl(174,59%,56%)] hover:text-[hsl(326,71%,62%)]"
                          >
                            Mark as read
                          </Button>
                        )}
                        {notif.postId && (
                          <Link
                            to={`/posts/${notif.postId}`}
                            className="text-xs text-[hsl(174,59%,56%)] transition-colors hover:text-[hsl(326,71%,62%)]"
                          >
                            View post
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default Notifications;