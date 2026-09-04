import { useEffect, useState } from "react";
import {
  getSessionSnapshot,
  subscribeSession,
  type SessionSnapshot,
} from "@/lib/session/sessionStore";

/** Full session snapshot: status, user, and whether storage is unreadable. */
export function useSession(): SessionSnapshot {
  const [snap, setSnap] = useState<SessionSnapshot>(() => getSessionSnapshot());
  useEffect(() => subscribeSession(setSnap), []);
  return snap;
}
