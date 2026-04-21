import { Canvas } from "@react-three/fiber";
import { AVATAR_REGISTRY, type AvatarDefinition } from "@/lib/virtualHub/avatars";
import { cn } from "@/lib/utils";
import { Lock } from "lucide-react";

interface AvatarSelectorProps {
  selectedId: string;
  onSelect: (id: string) => void;
}

function PreviewCanvas({ avatar }: { avatar: AvatarDefinition }) {
  return (
    <Canvas
      camera={{ position: [0, 1.2, 2.4], fov: 35 }}
      dpr={[1, 1.5]}
      style={{ width: "100%", height: "100%" }}
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 4, 2]} intensity={0.8} />
      <group position={[0, -0.6, 0]}>{avatar.preview({ scale: 0.9 })}</group>
    </Canvas>
  );
}

export function AvatarSelector({ selectedId, onSelect }: AvatarSelectorProps) {
  const lockedSlots = Math.max(0, 3 - AVATAR_REGISTRY.length);

  return (
    <div className="grid grid-cols-3 gap-3">
      {AVATAR_REGISTRY.map((avatar) => {
        const isSelected = avatar.id === selectedId;
        return (
          <button
            key={avatar.id}
            type="button"
            onClick={() => avatar.unlocked && onSelect(avatar.id)}
            disabled={!avatar.unlocked}
            className={cn(
              "group relative flex flex-col items-center rounded-lg border bg-muted/20 p-3 transition-all",
              isSelected
                ? "border-primary ring-2 ring-primary/40"
                : "border-border hover:border-primary/50",
              !avatar.unlocked && "opacity-50 cursor-not-allowed"
            )}
          >
            <div className="aspect-square w-full overflow-hidden rounded-md bg-background/40">
              <PreviewCanvas avatar={avatar} />
            </div>
            <span className="mt-2 text-sm font-medium text-foreground">
              {avatar.name}
            </span>
            <span className="text-[10px] text-muted-foreground line-clamp-2 text-center">
              {avatar.description}
            </span>
          </button>
        );
      })}
      {Array.from({ length: lockedSlots }).map((_, i) => (
        <div
          key={`locked-${i}`}
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/10 p-3 opacity-60"
        >
          <Lock className="h-6 w-6 text-muted-foreground" />
          <span className="mt-2 text-xs text-muted-foreground">Coming soon</span>
        </div>
      ))}
    </div>
  );
}