/**
 * MentionPopover — floating autocomplete for @mentions in textareas.
 * Attach to a textarea ref; it watches input for `@query` and shows candidates.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Brain } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { resolveMentionCandidates, type MentionCandidate } from '@/lib/mentions';

interface MentionPopoverProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onSelect: (username: string, startPos: number, endPos: number) => void;
}

export function MentionPopover({ textareaRef, value, onSelect }: MentionPopoverProps) {
  const [candidates, setCandidates] = useState<MentionCandidate[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [mentionQuery, setMentionQuery] = useState<{ query: string; start: number; end: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Extract @query from cursor position
  const extractMentionQuery = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return null;

    const cursorPos = textarea.selectionStart ?? 0;
    const textBeforeCursor = value.slice(0, cursorPos);

    // Find the last @ before cursor that starts a mention
    const atIdx = textBeforeCursor.lastIndexOf('@');
    if (atIdx === -1) return null;

    // Must be at start or preceded by whitespace
    if (atIdx > 0 && !/\s/.test(textBeforeCursor[atIdx - 1])) return null;

    const query = textBeforeCursor.slice(atIdx + 1);
    // No spaces in mention query
    if (/\s/.test(query)) return null;

    return { query, start: atIdx, end: cursorPos };
  }, [textareaRef, value]);

  useEffect(() => {
    const mq = extractMentionQuery();
    setMentionQuery(mq);

    if (!mq) {
      setCandidates([]);
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const results = await resolveMentionCandidates(mq.query);
      setCandidates(results);
      setActiveIndex(0);
    }, 150);

    return () => clearTimeout(debounceRef.current);
  }, [value, extractMentionQuery]);

  // Keyboard navigation
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || candidates.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (candidates.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(i => (i + 1) % candidates.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(i => (i - 1 + candidates.length) % candidates.length);
      } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && mentionQuery) {
        e.preventDefault();
        e.stopPropagation();
        const c = candidates[activeIndex];
        if (c) {
          onSelect(c.username, mentionQuery.start, mentionQuery.end);
          setCandidates([]);
        }
      } else if (e.key === 'Escape') {
        setCandidates([]);
      }
    };

    textarea.addEventListener('keydown', handleKeyDown);
    return () => textarea.removeEventListener('keydown', handleKeyDown);
  }, [candidates, activeIndex, mentionQuery, onSelect, textareaRef]);

  if (candidates.length === 0 || !mentionQuery) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full left-0 z-50 mb-1 w-72 max-h-64 overflow-y-auto rounded-lg border border-border/30 bg-popover shadow-xl backdrop-blur-xl"
    >
      {candidates.map((c, idx) => {
        // Check for duplicate display names
        const hasDuplicate = candidates.filter(
          other => other.displayName === c.displayName && other.userId !== c.userId
        ).length > 0;

        return (
          <button
            key={`${c.userId}-${c.username}`}
            type="button"
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
              idx === activeIndex
                ? 'bg-primary/15 text-foreground'
                : 'text-foreground/70 hover:bg-background/40'
            }`}
            onMouseDown={(e) => {
              e.preventDefault(); // prevent textarea blur
              onSelect(c.username, mentionQuery.start, mentionQuery.end);
              setCandidates([]);
            }}
            onMouseEnter={() => setActiveIndex(idx)}
          >
            {c.isEntity ? (
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Brain className="h-3.5 w-3.5" />
              </div>
            ) : (
              <Avatar
                avatarRef={c.avatarRef}
                username={c.username}
                displayName={c.displayName}
                size="sm"
                className="h-7 w-7"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-medium">
                  {c.displayName}
                </span>
                <span className="text-[0.6rem] text-foreground/40">
                  @{c.username}
                </span>
              </div>
              {c.isEntity ? (
                <span className="text-[0.55rem] text-primary/60">Network Entity</span>
              ) : hasDuplicate ? (
                <div className="flex items-center gap-1">
                  <span className="text-[0.55rem] text-foreground/30">
                    {c.peerId?.slice(0, 8) || c.userId.slice(0, 8)}…
                  </span>
                  <TrustBar score={c.trustScore} />
                </div>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function TrustBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color = pct >= 70 ? 'bg-green-500/60' : pct >= 40 ? 'bg-yellow-500/60' : 'bg-foreground/20';
  return (
    <div className="flex items-center gap-1">
      <div className="h-1 w-8 rounded-full bg-foreground/10">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[0.5rem] text-foreground/30">{pct}</span>
    </div>
  );
}
