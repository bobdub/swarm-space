import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Radio, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface StreamNotification {
  roomId: string;
  roomTitle: string;
  hostName: string;
  countdown: number;
}

interface StreamNotificationBannerProps {
  onJoin: (roomId: string) => void;
}

export function StreamNotificationBanner({ onJoin }: StreamNotificationBannerProps) {
  const [notification, setNotification] = useState<StreamNotification | null>(null);
  const [countdown, setCountdown] = useState(10);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    const handleStreamStart = (event: Event) => {
      const customEvent = event as CustomEvent<{
        roomId: string;
        roomTitle: string;
        hostName: string;
      }>;

      setNotification({
        ...customEvent.detail,
        countdown: 10,
      });
      setCountdown(10);
      setIsDismissed(false);
    };

    window.addEventListener("stream-starting", handleStreamStart);
    
    return () => {
      window.removeEventListener("stream-starting", handleStreamStart);
    };
  }, []);

  useEffect(() => {
    if (!notification || isDismissed) return;

    if (countdown <= 0) {
      setNotification(null);
      return;
    }

    const timer = setTimeout(() => {
      setCountdown(prev => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [notification, countdown, isDismissed]);

  const handleJoin = () => {
    if (notification) {
      onJoin(notification.roomId);
      setNotification(null);
    }
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    setTimeout(() => {
      setNotification(null);
    }, 300);
  };

  if (!notification) return null;

  return (
    <div
      className={cn(
        "fixed top-20 right-4 z-50 max-w-md transition-all duration-300",
        isDismissed ? "translate-x-[calc(100%+1rem)] opacity-0" : "translate-x-0 opacity-100"
      )}
    >
      <Card className="border-primary/50 bg-background/95 p-4 shadow-xl backdrop-blur-sm">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-full bg-primary/20">
                <Radio className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">Live Stream Starting</p>
                  <Badge variant="destructive" className="animate-pulse">
                    LIVE
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium">{notification.hostName}</span> is starting:{" "}
                  <span className="font-medium">{notification.roomTitle}</span>
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={handleDismiss}
              className="h-6 w-6"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
              <span>Starting in {countdown}s</span>
            </div>
            <Button type="button" size="sm" onClick={handleJoin}>
              Join Now
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
