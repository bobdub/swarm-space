/**
 * /remix — the Elemental Lab, the Forge and the Brains you can remix.
 *
 * `?tab=lab|forge|brains|assets` opens a tab directly (the builder's
 * "See more Remixes" link opens Brains). The Lab reads `?projectId=` or
 * `?target=main-brain` to pick where it mints.
 */
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { TopNavigationBar } from '@/components/TopNavigationBar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { LabTab } from '@/components/remix/LabTab';
import { BrainsTab } from '@/components/remix/BrainsTab';
import { AssetsTab } from '@/components/remix/AssetsTab';
import { CraftingTab } from '@/components/remix/CraftingTab';

const TABS = ['lab', 'forge', 'brains', 'assets'] as const;
type RemixTab = (typeof TABS)[number];

function tabFrom(value: string | null): RemixTab {
  if (value === 'crafting') return 'forge';
  return (TABS as readonly string[]).includes(value ?? '') ? (value as RemixTab) : 'lab';
}

export default function Remix() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  // Back to where the player came from; a direct visit goes to the Brain.
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/brain');
  };
  const tab = tabFrom(params.get('tab'));

  const onTab = (next: string) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  };

  return (
    <div className="min-h-screen">
    <TopNavigationBar />
    <main className="mx-auto w-full max-w-6xl px-3 pb-24 pt-4">
      <header className="mb-3 flex flex-col gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={goBack}
          className="h-7 w-fit gap-1 px-2 text-[11px]"
          data-testid="remix-back"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Lab &amp; Remix</h1>
        <p className="text-xs text-muted-foreground">
          Draw with what you gather, forge coins and tools, and remix any Brain into a project of your own.
        </p>
      </header>

      <Tabs value={tab} onValueChange={onTab} className="w-full">
        <TabsList className="h-9">
          <TabsTrigger value="lab" className="text-xs">Lab</TabsTrigger>
          <TabsTrigger value="forge" className="text-xs">Forge</TabsTrigger>
          <TabsTrigger value="brains" className="text-xs">Remix Brains</TabsTrigger>
          <TabsTrigger value="assets" className="text-xs">Assets</TabsTrigger>
        </TabsList>
        <TabsContent value="lab"><LabTab /></TabsContent>
        <TabsContent value="forge"><CraftingTab /></TabsContent>
        <TabsContent value="brains"><BrainsTab /></TabsContent>
        <TabsContent value="assets"><AssetsTab /></TabsContent>
      </Tabs>
    </main>
    </div>
  );
}
