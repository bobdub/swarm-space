import { Compass, Brain, Settings, Wallet, User, Server, Bell, MessageSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavigationItem {
  icon: LucideIcon;
  label: string;
  path: string;
}

/** Expand-menu order: Explore → Brain → Node → Wallet → (Chat) → Settings */
export const primaryNavigationItems: NavigationItem[] = [
  { icon: Compass, label: "Explore", path: "/explore" },
  { icon: Brain, label: "Brain", path: "/brain" },
  { icon: Server, label: "Node", path: "/node-dashboard" },
  { icon: Wallet, label: "Wallet", path: "/wallet" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

/** Bottom bar items for mobile — most-used subset */
export const mobileBottomBarItems: NavigationItem[] = [
  { icon: Compass, label: "Explore", path: "/explore" },
  { icon: Server, label: "Node", path: "/node-dashboard" },
  { icon: Wallet, label: "Wallet", path: "/wallet" },
  { icon: User, label: "Profile", path: "/profile" },
];

/** Kept for surfaces that still reference the alerts destination directly. */
export const alertsNavigationItem: NavigationItem = {
  icon: Bell,
  label: "Alerts",
  path: "/notifications",
};

/** Main-menu "Chat" entry — opens the network chat panel rather than a route.
 *  Rendered directly above Settings in the app menu. */
export const chatMenuItem = { icon: MessageSquare, label: "Chat" } as const;
