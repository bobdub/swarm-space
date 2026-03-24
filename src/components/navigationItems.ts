import { Home, Compass, Bell, Settings, Wallet, User, Server } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavigationItem {
  icon: LucideIcon;
  label: string;
  path: string;
}

export function getPrimaryNavigationItems(isLoggedIn: boolean): NavigationItem[] {
  const items: NavigationItem[] = [];
  if (!isLoggedIn) {
    items.push({ icon: Home, label: "Home", path: "/" });
  }

  items.push(
    { icon: User, label: "My Profile", path: "/profile" },
    { icon: Compass, label: "Explore", path: "/explore" },
    { icon: Server, label: "Node", path: "/node-dashboard" },
    { icon: Wallet, label: "Wallet", path: "/wallet" },
    { icon: Bell, label: "Alerts", path: "/notifications" },
    { icon: Settings, label: "Settings", path: "/settings" },
  );

  return items;
}

/** Bottom bar items for mobile — most-used subset */
export function getMobileBottomBarItems(isLoggedIn: boolean): NavigationItem[] {
  const items: NavigationItem[] = [];
  if (!isLoggedIn) {
    items.push({ icon: Home, label: "Home", path: "/" });
  }

  items.push(
    { icon: User, label: "Profile", path: "/profile" },
    { icon: Compass, label: "Explore", path: "/explore" },
    { icon: Server, label: "Node", path: "/node-dashboard" },
    { icon: Wallet, label: "Wallet", path: "/wallet" },
  );

  return items;
}
