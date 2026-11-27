import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/**
 * Copies text to the clipboard. Uses the async Clipboard API when the page
 * is a secure context, and falls back to a hidden textarea + execCommand so
 * copying still works on plain-http peer links and older WebViews.
 */
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.top = '-1000px';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Small copy icon for a chat message. Copies the message's raw text
 * (Markdown included, never the truncated preview) so a peer can paste it
 * anywhere. Sits in a message row's header; reveals on hover on desktop and
 * stays visible on touch screens.
 */
export function CopyMessageButton({
  text,
  className,
}: {
  text: string;
  className?: string;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(text);
    if (!ok) {
      toast.error('Copy failed');
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  const label = copied ? 'Copied' : 'Copy message';
  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className={cn(
        'inline-flex text-foreground/40 transition-opacity hover:text-foreground focus-visible:opacity-100',
        'md:opacity-0 md:group-hover:opacity-100',
        copied && 'text-primary md:opacity-100',
        className,
      )}
      title={label}
      aria-label={label}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}
