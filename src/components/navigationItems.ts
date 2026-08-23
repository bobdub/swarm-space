import { Compass, Brain, Settings, Wallet, User, Server, Bell } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavigationItem {
  icon: LucideIcon;
  label: string;
  path: string;
}

/** Expand-menu order: Explore → Brain → Settings → Node → Wallet */
export const primaryNavigationItems: NavigationItem[] = [
  { icon: Compass, label: "Explore", path: "/explore" },
  { icon: Brain, label: "Brain", path: "/brain" },
  { icon: Settings, label: "Settings", path: "/settings" },
  { icon: Server, label: "Node", path: "/node-dashboard" },
  { icon: Wallet, label: "Wallet", path: "/wallet" },
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
