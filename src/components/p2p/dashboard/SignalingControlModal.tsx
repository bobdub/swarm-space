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
import { SIGNALING_ACTIONS, type SignalingControlAction } from './signalingActions';

const DURATION_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'No auto-resume', value: null },
  { label: '30 seconds', value: 30 * 1000 },
  { label: '2 minutes', value: 2 * 60 * 1000 },
  { label: '5 minutes', value: 5 * 60 * 1000 },
  { label: '15 minutes', value: 15 * 60 * 1000 },
];

interface SignalingControlModalProps {
  action: SignalingControlAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (options: { autoResumeMs?: number | null }) => void;
}

export function SignalingControlModal({ action, open, onOpenChange, onConfirm }: SignalingControlModalProps) {
  const metadata = SIGNALING_ACTIONS[action];
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
