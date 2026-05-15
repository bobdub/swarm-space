/**
 * ProjectPicker — Phase 6 Remix Lab.
 *
 * Lists the current user's projects via `getUserProjects()` and
 * persists the selection through `setActiveProjectId()`. Falls back to
 * an empty disabled state when the user has no projects yet so the
 * Submit button can stay disabled with a clear reason.
 */
import { useEffect, useState } from 'react';
import { getUserProjects } from '@/lib/projects';
import {
  getActiveProjectId,
  setActiveProjectId,
} from '@/lib/remix/labProjectBridge';
import type { Project } from '@/types';

interface Props {
  value: string | null;
  onChange: (id: string | null) => void;
}

export function ProjectPicker({ value, onChange }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getUserProjects();
        if (cancelled) return;
        setProjects(list);
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
    setActiveProjectId(id);
    onChange(id);
  };

  return (
    <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
      <span className="hidden sm:inline">Project</span>
      <select
        aria-label="Active project"
        disabled={loading || projects.length === 0}
        value={value ?? ''}
        onChange={(e) => handle(e.target.value)}
        className="h-7 rounded border border-border/50 bg-background/60 px-1.5 text-[11px] text-foreground"
      >
        <option value="">
          {loading
            ? 'Loading…'
            : projects.length === 0
              ? 'No projects'
              : 'Choose project'}
        </option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </label>
  );
}

export default ProjectPicker;