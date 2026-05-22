/**
 * LabPopover — opens from the Builder Bar's Lab icon. Shows existing Lab
 * creations (project-scoped when a projectId is passed) plus a "+ Create
 * New" entry that navigates to the Lab with the project already wired.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FlaskConical } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import {
  subscribeMintedPrefabs,
  type MintedRecord,
} from '@/lib/remix/mintedPrefabsStore';

interface LabPopoverProps {
  projectId: string | null;
  selectedPrefabId: string | null;
  onSelectPrefab: (id: string | null) => void;
}

export function LabPopover({ projectId, selectedPrefabId, onSelectPrefab }: LabPopoverProps) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<MintedRecord[]>([]);
  const navigate = useNavigate();

  useEffect(() => subscribeMintedPrefabs(setAll), []);

  const items = useMemo(() => {
    // Project-scoped when a projectId exists; otherwise show every local mint.
    return projectId
      ? all.filter((r) => r.projectId === projectId)
      : all;
  }, [all, projectId]);

  const openLab = () => {
    setOpen(false);
    const url = projectId ? `/remix?projectId=${encodeURIComponent(projectId)}` : '/remix';
    navigate(url);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Open Lab creations"
          title="Lab creations"
          className="h-7 w-7"
        >
          <FlaskConical className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 p-2"
        // Avoid implicit form submit semantics inside the bar.
        role="form"
        aria-label="Lab creations"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-medium text-foreground/90">
            Lab creations{projectId ? ' · this project' : ''}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={openLab}
            className="h-7 gap-1 text-[11px]"
          >
            <Plus className="h-3 w-3" />
            Create New
          </Button>
        </div>
        <div className="max-h-64 overflow-y-auto pr-1">
          {items.length === 0 ? (
            <div className="px-1 py-3 text-[11px] text-muted-foreground">
              No creations yet. Open the Lab to mint one.
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {items.map((rec) => {
                const selected = selectedPrefabId === rec.prefab.id;
                return (
                  <button
                    key={rec.id}
                    type="button"
                    onClick={() => onSelectPrefab(selected ? null : rec.prefab.id)}
                    aria-pressed={selected}
                    className={[
                      'flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[11px] transition-all',
                      selected
                        ? 'border-primary bg-primary/10'
                        : 'border-border/40 bg-background/60 hover:border-border',
                    ].join(' ')}
                  >
                    <span
                      className="h-5 w-5 shrink-0 rounded-sm border border-border/40"
                      style={{ backgroundColor: rec.prefab.color }}
                      aria-hidden="true"
                    />
                    <span className="flex flex-col leading-tight">
                      <span className="font-medium text-foreground/90">{rec.prefab.label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {rec.prefab.formula} · {rec.prefab.sectionId}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default LabPopover;