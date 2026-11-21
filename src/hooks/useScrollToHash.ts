import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Scroll to the element named by the URL hash once it renders, so links from
 * Notifications (e.g. /settings#blocked-users) land on the right section.
 * Polls briefly because panels often mount after their data loads.
 */
export function useScrollToHash(): void {
  const { hash } = useLocation();
  useEffect(() => {
    const id = hash.replace(/^#/, "");
    if (!id) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        window.clearInterval(timer);
      } else if (++tries > 20) {
        window.clearInterval(timer);
      }
    }, 150);
    return () => window.clearInterval(timer);
  }, [hash]);
}
