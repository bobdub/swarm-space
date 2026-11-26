/**
 * /remix — the Elemental Lab, the Forge and the Brains you can remix.
 *
 * `?tab=lab|forge|brains|assets` opens a tab directly (the builder's
 * "See more Remixes" link opens Brains). The Lab reads `?projectId=` or
 * `?target=main-brain` to pick where it mints.
 */
import { useSearchParams } from 'react-router-dom';
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
  const tab = tabFrom(params.get('tab'));

  const onTab = (next: string) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-3 py-4">
      <header className="mb-3 flex flex-col gap-1">
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
  );
}
