/**
 * ProjectPicker — where Lab creations go.
 *
 * Lists the current user's projects via `getUserProjects()`. With
 * `includeMainBrain`, the shared Main Brain is offered first as a primary
 * target (value `MAIN_BRAIN_TARGET`); picking it never touches the saved
 * active project. Project picks persist through `setActiveProjectId()`.
 */
import { useEffect, useState } from 'react';
import { getUserProjects } from '@/lib/projects';
import {
  MAIN_BRAIN_TARGET,
  getActiveProjectId,
  isMainBrainTarget,
  setActiveProjectId,
} from '@/lib/remix/labProjectBridge';
import type { Project } from '@/types';

interface Props {
  value: string | null;
  onChange: (id: string | null) => void;
  /** Offer the Main Brain as a target alongside private projects. */
  includeMainBrain?: boolean;
  label?: string;
}

export function ProjectPicker({ value, onChange, includeMainBrain = false, label = 'Project' }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getUserProjects();
        if (cancelled) return;
        setProjects(list);
        if (includeMainBrain) {
          // The caller already resolved the target (Main Brain or the
          // project the Lab was opened from); only drop a stale project.
          if (value && !isMainBrainTarget(value) && !list.find((p) => p.id === value)) {
            onChange(MAIN_BRAIN_TARGET);
          }
          return;
        }
        // If saved id no longer valid, clear it.
        const saved = getActiveProjectId();
        if (saved && !list.find((p) => p.id === saved)) {
          setActiveProjectId(null);
          onChange(null);
        } else if (saved && saved !== value) {
          onChange(saved);
        }
      } catch (err) {
        console.warn('[ProjectPicker] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handle = (next: string) => {
    const id = next || null;
    if (!isMainBrainTarget(id)) setActiveProjectId(id);
    onChange(id);
  };

  const disabled = !includeMainBrain && (loading || projects.length === 0);

  return (
    <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
      <span className="hidden sm:inline">{label}</span>
      <select
        aria-label={includeMainBrain ? 'Target Brain' : 'Active project'}
        data-testid="lab-target-picker"
        disabled={disabled}
        value={value ?? ''}
        onChange={(e) => handle(e.target.value)}
        className="h-7 max-w-[11rem] rounded border border-border/50 bg-background/60 px-1.5 text-[11px] text-foreground"
      >
        {includeMainBrain ? (
          <option value={MAIN_BRAIN_TARGET}>🧠 Main Brain</option>
        ) : (
          <option value="">
            {loading
              ? 'Loading…'
              : projects.length === 0
                ? 'No projects'
                : 'Choose project'}
          </option>
        )}
        {includeMainBrain && projects.length > 0 && (
          <option disabled value="__divider">── Your projects ──</option>
        )}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </label>
  );
}

export default ProjectPicker;
