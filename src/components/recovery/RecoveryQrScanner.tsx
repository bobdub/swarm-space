/**
 * Scan a Recovery QR code with this device's camera.
 *
 * Uses the browser's built-in BarcodeDetector (Chrome, Edge, Android and
 * ChromeOS). Where it is missing, the person can still point their phone's
 * camera app at the code, which opens the Recovery Link directly, or pick a
 * photo of the code. Frames are read locally and never leave the device.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Camera, ImageUp, Loader2, X } from "lucide-react";

interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource | ImageBitmap): Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function barcodeDetector(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

function qrScanSupported(): boolean {
  return barcodeDetector() !== null;
}

const SCAN_INTERVAL_MS = 250;

export function RecoveryQrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "unsupported" | "denied">(qrScanSupported() ? "starting" : "unsupported");
  const [imageError, setImageError] = useState<string | null>(null);
  const doneRef = useRef(false);

  const finish = (text: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onResult(text);
  };

  useEffect(() => {
    const Detector = barcodeDetector();
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;
    const detector = new Detector({ formats: ["qr_code"] });
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(async (s) => {
      if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = s;
      await video.play().catch(() => undefined);
      setStatus("scanning");
      timer = window.setInterval(() => {
        if (doneRef.current || video.readyState < 2) return;
        void detector.detect(video).then((codes) => {
          const hit = codes.find((c) => typeof c.rawValue === "string" && c.rawValue.length > 0);
          if (hit) finish(hit.rawValue);
        }).catch(() => undefined);
      }, SCAN_INTERVAL_MS);
    }).catch(() => { if (!cancelled) setStatus("denied"); });
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scanImage = async (file: File | undefined) => {
    setImageError(null);
    const Detector = barcodeDetector();
    if (!file || !Detector) return;
    try {
      const bitmap = await createImageBitmap(file);
      const codes = await new Detector({ formats: ["qr_code"] }).detect(bitmap);
      bitmap.close?.();
      const hit = codes.find((c) => c.rawValue);
      if (hit) finish(hit.rawValue);
      else setImageError("No QR code found in that picture.");
    } catch {
      setImageError("Could not read that picture.");
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-medium"><Camera className="h-4 w-4" /> Scan Recovery QR</p>
        <Button variant="ghost" size="icon" aria-label="Close scanner" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      {status === "unsupported" ? (
        <Alert>
          <AlertDescription className="text-xs leading-relaxed">
            This browser cannot scan codes here. Point your phone's camera at the Recovery QR instead: it opens the
            recovery page directly. You can also paste the Recovery Link above.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="relative overflow-hidden rounded-md bg-black">
            <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline aria-label="Camera preview" />
            {status === "starting" && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-white/80">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting camera…
              </div>
            )}
          </div>
          {status === "denied" && (
            <p className="text-xs text-amber-500">The camera is not available. Allow camera access, or choose a photo of the code.</p>
          )}
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border/60 p-2 text-xs text-muted-foreground hover:text-foreground">
            <ImageUp className="h-4 w-4" /> Choose a photo of the code
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => void scanImage(e.target.files?.[0])} />
          </label>
          {imageError && <p className="text-xs text-amber-500">{imageError}</p>}
          <p className="text-xs text-muted-foreground">The picture is read on this device only.</p>
        </>
      )}
    </div>
  );
}
