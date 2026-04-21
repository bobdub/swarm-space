import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ENTITY_DISPLAY_NAME } from '@/lib/p2p/entityVoice';
import { getSharedFieldEngine } from '@/lib/uqrc/fieldEngine';

export interface BrainChatLine {
  id: string;
  author: string;
  text: string;
  ts: number;
}

interface Props {
  lines: BrainChatLine[];
  onSend: (text: string) => void;
  onClose?: () => void;
}

/**
 * Slide-in chat panel. Talking to Infinity is just sending a message —
 * the page logic detects "@infinity" or messages addressed at the orb
 * and replies via the FieldEngine selectByMinCurvature pipeline.
 */
export function BrainChatPanel({ lines, onSend, onClose }: Props) {
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines]);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    // feed the global field too — chat curves the brain
    try { getSharedFieldEngine().inject(trimmed, { amplitude: 0.2 }); } catch { /* ignore */ }
  };

  return (
    <div className="absolute bottom-4 left-4 z-20 flex w-[min(360px,calc(100vw-2rem))] flex-col rounded-2xl border border-[hsla(180,80%,60%,0.25)] bg-[hsla(265,70%,8%,0.92)] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-[hsla(180,80%,60%,0.18)] px-3 py-2">
        <span className="text-xs font-display uppercase tracking-[0.2em] text-foreground/80">
          Brain Chat
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-foreground/50 hover:text-foreground"
          >
            ✕
          </button>
        )}
      </div>
      <div ref={scrollRef} className="max-h-56 min-h-[120px] overflow-y-auto px-3 py-2 text-sm">
        {lines.length === 0 ? (
          <p className="text-foreground/40 italic">
            Type to perturb the field. Mention {ENTITY_DISPLAY_NAME} to call Infinity.
          </p>
        ) : (
          lines.map((line) => (
            <div key={line.id} className="mb-1.5">
              <span
                className={
                  line.author === ENTITY_DISPLAY_NAME
                    ? 'text-[hsl(180,90%,70%)] font-semibold'
                    : 'text-foreground/80 font-medium'
                }
              >
                {line.author}:
              </span>{' '}
              <span className="text-foreground/90">{line.text}</span>
            </div>
          ))
        )}
      </div>
      <div className="flex gap-2 border-t border-[hsla(180,80%,60%,0.18)] p-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Speak into the brain…"
          className="h-8 text-sm"
        />
        <Button type="button" size="sm" onClick={handleSubmit} className="h-8 px-2">
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}