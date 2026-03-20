/**
 * Cookie / Local Storage Consent Banner
 * Must be accepted before any localStorage writes occur.
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Shield } from "lucide-react";

const CONSENT_KEY = "flux_storage_consent";

export function hasStorageConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === "granted";
  } catch {
    return false;
  }
}

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Show if no consent yet
    if (!hasStorageConsent()) {
      setVisible(true);
    }
  }, []);

  const handleAccept = () => {
    try {
      localStorage.setItem(CONSENT_KEY, "granted");
    } catch {}
    setVisible(false);
    window.dispatchEvent(new CustomEvent("storage-consent-granted"));
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-[9999] p-4 md:p-6">
      <div className="mx-auto max-w-lg rounded-xl border border-primary/20 bg-[hsla(245,70%,6%,0.97)] backdrop-blur-xl p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <Shield className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 space-y-2">
            <p className="text-sm font-medium text-foreground">
              This app stores data locally on your device
            </p>
            <p className="text-xs text-foreground/50 leading-relaxed">
              We use local storage and cookies to save your account, preferences, 
              and encrypted mesh data. No data is sent to external servers — everything 
              stays on your device and the peer network.
            </p>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={handleAccept} className="gap-1.5">
                Accept & Continue
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
