/**
 * /remix — Elemental Alchemy Lab page shell.
 *
 * Three tabs: Lab (creator), Brains (universe remixing), Assets (minted
 * molecules). The Lab is the only live surface in the scaffold stage;
 * Brains and Assets ship as placeholders with documented follow-ups.
 */
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { LabTab } from '@/components/remix/LabTab';
import { BrainsTab } from '@/components/remix/BrainsTab';
import { AssetsTab } from '@/components/remix/AssetsTab';

export default function Remix() {
  return (
    <main className="mx-auto w-full max-w-6xl px-3 py-4">
      <header className="mb-3 flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          Elemental Alchemy Lab
        </h1>
        <p className="text-xs text-muted-foreground">
          Draw with real elements. Evolve them in the UQRC field. Mint living
          assets that drop straight into your Project Brain.
        </p>
      </header>

      <Tabs defaultValue="lab" className="w-full">
        <TabsList className="h-9">
          <TabsTrigger value="lab" className="text-xs">Lab</TabsTrigger>
          <TabsTrigger value="brains" className="text-xs">Brains</TabsTrigger>
          <TabsTrigger value="assets" className="text-xs">Assets</TabsTrigger>
        </TabsList>
        <TabsContent value="lab"><LabTab /></TabsContent>
        <TabsContent value="brains"><BrainsTab /></TabsContent>
        <TabsContent value="assets"><AssetsTab /></TabsContent>
      </Tabs>
    </main>
  );
}