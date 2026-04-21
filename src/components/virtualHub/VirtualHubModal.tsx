import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AvatarSelector } from "./AvatarSelector";
import { DeviceCheckStep } from "./DeviceCheckStep";
import {
  loadHubPrefs,
  saveHubPrefs,
  DEFAULT_AVATAR_ID,
} from "@/lib/virtualHub/avatars";

interface VirtualHubModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

type Step = "avatar" | "devices";

export function VirtualHubModal({ open, onOpenChange, projectId }: VirtualHubModalProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("avatar");
  const [avatarId, setAvatarId] = useState<string>(DEFAULT_AVATAR_ID);
  const [audioInputId, setAudioInputId] = useState<string | undefined>();
  const [audioOutputId, setAudioOutputId] = useState<string | undefined>();
  const [permissionGranted, setPermissionGranted] = useState(false);

  useEffect(() => {
    if (open) {
      const prefs = loadHubPrefs();
      setAvatarId(prefs.avatarId);
      setAudioInputId(prefs.audioInputId);
      setAudioOutputId(prefs.audioOutputId);
      setStep("avatar");
      setPermissionGranted(false);
    }
  }, [open]);

  const handleJoin = () => {
    saveHubPrefs({ avatarId, audioInputId, audioOutputId });
    onOpenChange(false);
    navigate(`/projects/${projectId}/hub`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === "avatar" ? "Choose your avatar" : "Test your audio"}
          </DialogTitle>
          <DialogDescription>
            {step === "avatar"
              ? "Pick how you'll appear inside the virtual hub."
              : "Verify your microphone and speakers before entering."}
          </DialogDescription>
        </DialogHeader>

        {step === "avatar" ? (
          <AvatarSelector selectedId={avatarId} onSelect={setAvatarId} />
        ) : (
          <DeviceCheckStep
            audioInputId={audioInputId}
            audioOutputId={audioOutputId}
            onChange={(p) => {
              setAudioInputId(p.audioInputId);
              setAudioOutputId(p.audioOutputId);
            }}
            onPermissionGranted={setPermissionGranted}
          />
        )}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          {step === "devices" && (
            <Button type="button" variant="outline" onClick={() => setStep("avatar")}>
              Back
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          {step === "avatar" ? (
            <Button type="button" onClick={() => setStep("devices")}>
              Continue
            </Button>
          ) : (
            <Button type="button" onClick={handleJoin} disabled={!permissionGranted}>
              Join virtual hub
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}