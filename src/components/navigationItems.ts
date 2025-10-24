import { Home, Compass, Bell, Folder, Calendar, CheckSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavigationItem {
  icon: LucideIcon;
  label: string;
  path: string;
}

export const primaryNavigationItems: NavigationItem[] = [
  { icon: Home, label: "Home", path: "/" },
  { icon: Compass, label: "Explore", path: "/explore" },
  { icon: Bell, label: "Notifications", path: "/notifications" },
  { icon: Folder, label: "Files", path: "/files" },
  { icon: Calendar, label: "Planner", path: "/planner" },
  { icon: CheckSquare, label: "Tasks", path: "/tasks" },
];
