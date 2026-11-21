// Notification system for social interactions
import { Notification } from "@/types";
import { get, put, getAll } from "./store";
import { getCurrentUser } from "./auth";

/**
 * Create a notification for a user
 */
export async function createNotification(
  notification: Omit<Notification, "id" | "createdAt" | "read">
): Promise<Notification> {
  const newNotification: Notification = {
    ...notification,
    id: crypto.randomUUID(),
    read: false,
    createdAt: new Date().toISOString(),
  };

  await put("notifications", newNotification);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("notifications-updated", {
        detail: { userId: notification.userId },
      })
    );
  }
  return newNotification;
}

/**
 * Get all notifications for current user
 */
export async function getNotifications(): Promise<Notification[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const allNotifications = (await getAll("notifications")) as Notification[];
  return allNotifications
    .filter((n) => n.userId === user.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Get unread notification count
 */
export async function getUnreadCount(): Promise<number> {
  const notifications = await getNotifications();
  return notifications.filter((n) => !n.read).length;
}

/**
 * Mark notification as read
 */
export async function markAsRead(notificationId: string): Promise<void> {
  const notification = (await get("notifications", notificationId)) as Notification;
  if (notification) {
    notification.read = true;
    await put("notifications", notification);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("notifications-updated", {
          detail: { userId: notification.userId },
        })
      );
    }
  }
}

/**
 * Mark all notifications as read for current user
 */
export async function markAllAsRead(): Promise<void> {
  const notifications = await getNotifications();
  const unread = notifications.filter((n) => !n.read);

  for (const notification of unread) {
    notification.read = true;
    await put("notifications", notification);
  }
  if (unread.length > 0 && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("notifications-updated", {
        detail: { userId: notifications[0]?.userId },
      })
    );
  }
}

export type SystemNoticeType = "credits_received" | "badge_unlocked" | "wallet_deposit" | "moderation" | "system";

/**
 * Record a background event in the Notifications inbox instead of popping a
 * toast. Used for things that happen while the user may not be looking
 * (credits arriving, badges, deposits, boot-time restores, replays), the same
 * way the recovery vault reports custody. Never throws: a busy store just
 * drops the notice.
 */
export async function notifySystem(notice: {
  type: SystemNoticeType;
  title: string;
  content?: string;
  link?: string;
  linkLabel?: string;
  userId?: string;
  triggeredBy?: string;
  triggeredByName?: string;
}): Promise<Notification | null> {
  try {
    const userId = notice.userId ?? getCurrentUser()?.id;
    if (!userId) return null;
    return await createNotification({
      userId,
      type: notice.type,
      title: notice.title,
      content: notice.content,
      link: notice.link,
      linkLabel: notice.linkLabel,
      triggeredBy: notice.triggeredBy ?? "system",
      triggeredByName: notice.triggeredByName ?? "Swarm Space",
    });
  } catch (error) {
    console.warn("[notifications] Failed to record system notice", error);
    return null;
  }
}

/** Where each kind of mute/hide/block can be undone. */
export const MODERATION_LINKS = {
  blockedUsers: { link: "/settings#blocked-users", linkLabel: "Manage blocked users" },
  blockedNodes: { link: "/node-dashboard#blocked-nodes", linkLabel: "Manage blocked nodes" },
  connectionLibrary: { link: "/node-dashboard#connection-library", linkLabel: "Open Connection Library" },
  unsupportedContent: { link: "/node-dashboard#unsupported-content", linkLabel: "Resume support" },
} as const;

/**
 * Record a mute, hide or block in the Notifications inbox, with a link to the
 * list where it can be undone.
 */
export function notifyModeration(
  title: string,
  content: string,
  where: keyof typeof MODERATION_LINKS,
): void {
  void notifySystem({ type: "moderation", title, content, ...MODERATION_LINKS[where] });
}
