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
    const profileLink = (
      <Link
        to={`/u/${notif.triggeredBy}?tab=posts#profile-feed-top`}
        className="font-semibold text-[hsl(326,71%,62%)] hover:text-[hsl(326,71%,72%)]"
      >
        {notif.triggeredByName}
      </Link>
    );

    switch (notif.type) {
      case "reaction":
        return (
          <>
            {profileLink} reacted {notif.emoji} to your post
          </>
        );
      case "comment":
        return (
          <>
            {profileLink} commented on your post
            {notif.content && (
              <span className="block mt-1 text-sm text-foreground/60 italic">"{notif.content}"</span>
            )}
          </>
        );
      case "follow":
        return (
          <>
            {profileLink} started following you
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
        <header className="space-y-4 text-center">
          <h1 className="text-3xl font-display font-bold uppercase tracking-[0.24em] text-foreground md:text-4xl">
            Notifications
          </h1>
          <p className="mx-auto max-w-2xl text-sm text-foreground/70 md:text-base">
            Stay in sync with new reactions, follows, and conversations happening around your posts.
          </p>
          <div className="flex justify-center">
            {unreadCount > 0 && (
              <Button
                onClick={handleMarkAllAsRead}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <Check className="h-4 w-4" />
                Mark all as read ({unreadCount})
              </Button>
            )}
          </div>
        </header>

        <section>
          {isLoading ? (
            <Card className="rounded-3xl border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,12%,0.45)] px-6 py-16 text-center text-sm text-foreground/60 backdrop-blur-xl">
              <div className="animate-pulse space-y-3">
                <Bell className="mx-auto h-10 w-10 text-foreground/40" />
                <p>Loading notifications…</p>
              </div>
            </Card>
          ) : notifications.length === 0 ? (
            <Card className="rounded-3xl border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.4)] px-6 py-16 text-center text-sm text-foreground/60 backdrop-blur-xl">
              <Bell className="mx-auto mb-4 h-12 w-12 text-[hsl(174,59%,56%)] opacity-50" />
              <p>No notifications yet</p>
              <p className="mt-2 text-sm text-foreground/40">
                You'll see reactions, comments, and other interactions here.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {notifications.map((notif) => (
                <Card
                  key={notif.id}
                  className={`p-4 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.3)] ${
                    notif.read
                      ? "border-[hsla(174,59%,56%,0.12)] bg-[hsla(245,70%,8%,0.3)]"
                      : "border-[hsla(326,71%,62%,0.25)] bg-[hsla(245,70%,12%,0.6)] shadow-[0_0_20px_hsla(326,71%,62%,0.15)]"
                  }`}
                >
                  <div className="flex gap-4">
                    <Link to={`/u/${notif.triggeredBy}?tab=posts#profile-feed-top`} className="flex-shrink-0">
                      <Avatar username={notif.triggeredBy} displayName={notif.triggeredByName} size="md" />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm leading-relaxed text-foreground/90">
                          {getNotificationMessage(notif)}
                        </p>
                        <div className="flex shrink-0 items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,8%,0.6)]">
                            {getNotificationIcon(notif.type, notif.emoji)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <span className="text-xs font-display uppercase tracking-wider text-foreground/50">
                          {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                        </span>
                        {!notif.read && (
                          <Button
                            onClick={() => handleMarkAsRead(notif.id)}
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs text-[hsl(174,59%,56%)] hover:text-[hsl(326,71%,62%)]"
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