import { Home, Compass, Bell, Settings, Flame, Wallet, User, Server } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavigationItem {
  icon: LucideIcon;
  label: string;
  path: string;
}

export const primaryNavigationItems: NavigationItem[] = [
  { icon: Home, label: "Home", path: "/" },
  { icon: Flame, label: "Trending", path: "/trending" },
  { icon: Compass, label: "Explore", path: "/explore" },
  { icon: Server, label: "Node", path: "/node-dashboard" },
  { icon: Wallet, label: "Wallet", path: "/wallet" },
  { icon: User, label: "Profile", path: "/profile" },
  { icon: Bell, label: "Alerts", path: "/notifications" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

/** Bottom bar items for mobile — most-used subset */
export const mobileBottomBarItems: NavigationItem[] = [
  { icon: Home, label: "Home", path: "/" },
  { icon: Compass, label: "Explore", path: "/explore" },
  { icon: Server, label: "Node", path: "/node-dashboard" },
  { icon: Wallet, label: "Wallet", path: "/wallet" },
  { icon: User, label: "Profile", path: "/profile" },
];
