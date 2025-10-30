import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Smile } from "lucide-react";

interface ReactionPickerProps {
  onReactionSelect: (emoji: string) => void;
  currentReactions: string[];
  className?: string;
}

const QUICK_REACTIONS = ["❤️", "🔥", "💡", "🚀", "👏", "🎉", "💯", "✨"];

const EMOJI_CATEGORIES = {
  Smileys: ["😀", "😁", "😂", "🤣", "😊", "😍", "🥰", "😎", "🤔", "🤩"],
  Hearts: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💖"],
  Hands: ["👍", "👎", "👏", "🙌", "👊", "✊", "🤝", "🙏", "✋", "🤚"],
  Symbols: ["🔥", "💡", "⚡", "✨", "💯", "🚀", "🎉", "🎊", "🏆", "⭐"],
  Objects: ["💎", "🎯", "🎨", "🎭", "🎪", "🎬", "🎮", "🎲", "🎰", "🎳"],
  Nature: ["🌟", "🌈", "🌸", "🌺", "🌻", "🌼", "🌷", "🍀", "🌹", "🌿"],
};

export function ReactionPicker({
  onReactionSelect,
  currentReactions,
  className,
}: ReactionPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<keyof typeof EMOJI_CATEGORIES>("Smileys");

  const handleReactionClick = (emoji: string) => {
    onReactionSelect(emoji);
  };

  const selection = new Set(currentReactions);

  const renderTriggerLabel = () => {
    if (!currentReactions.length) {
      return <Smile className="h-4 w-4" />;
    }

    if (currentReactions.length === 1) {
      return <span className="text-lg">{currentReactions[0]}</span>;
    }

    if (currentReactions.length === 2) {
      return (
        <span className="flex items-center gap-1 text-lg">
          <span>{currentReactions[0]}</span>
          <span>{currentReactions[1]}</span>
        </span>
      );
    }

    const remaining = currentReactions.length - 2;
    return (
      <span className="flex items-center gap-1 text-lg">
        <span>{currentReactions[0]}</span>
        <span>{currentReactions[1]}</span>
        <span className="text-xs font-medium text-foreground/70">+{remaining}</span>
      </span>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`gap-2 rounded-full border border-transparent px-4 py-2 text-foreground/70 transition-all duration-200 hover:border-[hsla(326,71%,62%,0.32)] hover:bg-[hsla(245,70%,16%,0.55)] hover:text-foreground ${className ?? ""}`}
        >
          {renderTriggerLabel()}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.95)] p-4 backdrop-blur-2xl">
        <div className="space-y-4">
          {/* Quick reactions */}
          <div className="space-y-2">
            <div className="text-xs font-display uppercase tracking-[0.35em] text-foreground/55">
              Quick Reactions
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleReactionClick(emoji)}
                  type="button"
                  aria-pressed={selection.has(emoji)}
                  className={`rounded-lg border p-2 text-2xl transition-all duration-200 hover:scale-110 ${
                    selection.has(emoji)
                      ? "border-[hsla(326,71%,62%,0.6)] bg-[hsla(326,71%,62%,0.2)]"
                      : "border-[hsla(174,59%,56%,0.18)] hover:border-[hsla(326,71%,62%,0.32)]"
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          {/* Category tabs */}
          <div className="space-y-2">
            <div className="flex gap-1 overflow-x-auto pb-1">
              {Object.keys(EMOJI_CATEGORIES).map((category) => (
                <button
                  key={category}
                  onClick={() => setActiveCategory(category as keyof typeof EMOJI_CATEGORIES)}
                  className={`rounded-lg px-3 py-1 text-xs font-display uppercase tracking-wider transition-all duration-200 ${
                    activeCategory === category
                      ? "bg-[hsla(326,71%,62%,0.2)] text-[hsl(326,71%,62%)]"
                      : "text-foreground/60 hover:text-foreground"
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>

            {/* Emoji grid */}
            <div className="grid grid-cols-8 gap-1">
              {EMOJI_CATEGORIES[activeCategory].map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleReactionClick(emoji)}
                  type="button"
                  aria-pressed={selection.has(emoji)}
                  className={`rounded-lg border p-2 text-xl transition-all duration-200 hover:scale-110 ${
                    selection.has(emoji)
                      ? "border-[hsla(326,71%,62%,0.6)] bg-[hsla(326,71%,62%,0.2)]"
                      : "border-transparent hover:border-[hsla(174,59%,56%,0.18)]"
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
