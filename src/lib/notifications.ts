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
