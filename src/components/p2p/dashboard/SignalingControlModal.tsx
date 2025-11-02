import { useEffect, useMemo, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Info } from 'lucide-react';

export type SignalingControlAction = 'pause-all' | 'pause-inbound' | 'pause-outbound';

interface ActionMetadata {
  title: string;
  description: string;
  impact: string;
  resumeHint: string;
  defaultDuration?: number | null;
}

const ACTION_METADATA: Record<SignalingControlAction, ActionMetadata> = {
  'pause-all': {
    title: 'Pause all signaling and traffic',
    description:
      'Incoming handshakes and outbound dials will be rejected until you resume networking. Existing peers remain connected but new connections will fail.',
    impact:
      'Use this when you need a full network quarantine. Background diagnostics and mesh maintenance will halt until signaling resumes.',
    resumeHint: 'Auto-resume ensures you do not forget to re-open the node after an emergency stop.',
    defaultDuration: 5 * 60 * 1000,
  },
  'pause-inbound': {
    title: 'Pause inbound handshakes',
    description:
      'Inbound peers will be rejected while outbound dialing remains available. Existing peers stay connected.',
    impact:
      'Choose this when you need to stop new peers from attaching while keeping current sessions online.',
    resumeHint: 'Inbound pauses are easy to forget; consider selecting an automatic resume window.',
    defaultDuration: 3 * 60 * 1000,
  },
  'pause-outbound': {
    title: 'Pause outbound dialing',
    description:
      'Your node will stop initiating new peer connections but will continue accepting inbound sessions.',
    impact:
      'This is useful when investigating outbound flooding or when you want to freeze reconnection storms.',
    resumeHint: 'Auto-resume helps restore proactive dialing once mitigation checks are complete.',
    defaultDuration: 2 * 60 * 1000,
  },
};

const DURATION_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'No auto-resume', value: null },
  { label: '30 seconds', value: 30 * 1000 },
  { label: '2 minutes', value: 2 * 60 * 1000 },
  { label: '5 minutes', value: 5 * 60 * 1000 },
  { label: '15 minutes', value: 15 * 60 * 1000 },
];

export const SIGNALING_ACTIONS = ACTION_METADATA;

interface SignalingControlModalProps {
  action: SignalingControlAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (options: { autoResumeMs?: number | null }) => void;
}

export function SignalingControlModal({ action, open, onOpenChange, onConfirm }: SignalingControlModalProps) {
  const metadata = ACTION_METADATA[action];
  const [selectedDuration, setSelectedDuration] = useState<number | null>(metadata.defaultDuration ?? null);

  useEffect(() => {
    if (open) {
      setSelectedDuration(metadata.defaultDuration ?? null);
    }
  }, [open, metadata.defaultDuration]);

  const selectedOptionLabel = useMemo(() => {
    const match = DURATION_OPTIONS.find((option) => option.value === selectedDuration);
    return match ? match.label : 'Custom';
  }, [selectedDuration]);

  const handleConfirm = () => {
    onConfirm({ autoResumeMs: selectedDuration ?? undefined });
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{metadata.title}</AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p>{metadata.description}</p>
            <div className="flex items-start gap-2 rounded-md border border-border/40 bg-muted/40 p-3 text-sm text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{metadata.impact}</span>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 py-2">
          <Label htmlFor="auto-resume-select">Auto-resume window</Label>
          <Select
            value={selectedDuration != null ? String(selectedDuration) : 'null'}
            onValueChange={(value) => {
              if (value === 'null') {
                setSelectedDuration(null);
              } else {
                const parsed = Number(value);
                setSelectedDuration(Number.isFinite(parsed) ? parsed : null);
              }
            }}
          >
            <SelectTrigger id="auto-resume-select" aria-label="Select auto resume window">
              <SelectValue placeholder={selectedOptionLabel} />
            </SelectTrigger>
            <SelectContent>
              {DURATION_OPTIONS.map((option) => (
                <SelectItem key={option.label} value={option.value == null ? 'null' : String(option.value)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{metadata.resumeHint}</p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>Confirm pause</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
