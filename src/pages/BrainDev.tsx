/**
 * BrainDev — public, auth-free preview of the `/brain` universe used for
 * scaffolding inspection and manual QA. Mirrors `BrainUniverse` but
 * lives outside the AuthGuard route group so the scene can be poked
 * without going through the login gate.
 *
 * Use this route to validate Phase scaffoldings (World Building Tools,
 * Remix / Lab assets, NPC layers, Portal casting, etc.) end-to-end in
 * the preview viewport.
 */
import { useNavigate } from 'react-router-dom';
import BrainUniverseScene from '@/components/brain/BrainUniverseScene';
import { lobbyVariant } from '@/lib/brain/variants';

export default function BrainDev() {
  const navigate = useNavigate();
  const variant = lobbyVariant({
    onLeave: () => navigate('/'),
  });
  return (
    <div className="relative">
      <div
        className="fixed top-2 left-2 z-50 rounded bg-[hsla(265,70%,8%,0.75)] backdrop-blur px-2 py-1 text-[10px] uppercase tracking-wider text-foreground/80 pointer-events-none"
        aria-label="Brain dev banner"
      >
        Brain Dev · no auth
      </div>
      <BrainUniverseScene variant={variant} />
    </div>
  );
}
