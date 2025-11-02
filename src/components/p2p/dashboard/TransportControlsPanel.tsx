import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, Radio } from 'lucide-react';
import { getFeatureFlags, setFeatureFlag } from '@/config/featureFlags';
import { useEffect, useState } from 'react';
import type { P2PTransportStatus } from '@/lib/p2p/manager';

interface TransportControlsPanelProps {
  transports: P2PTransportStatus[];
}

export function TransportControlsPanel({ transports }: TransportControlsPanelProps) {
  const [flags, setFlags] = useState(getFeatureFlags());

  useEffect(() => {
    // Poll for flag changes (could be subscription-based in the future)
    const interval = setInterval(() => {
      setFlags(getFeatureFlags());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const handleToggleTransport = (transportId: 'webtorrent' | 'gun', enabled: boolean) => {
    const flagKey = transportId === 'webtorrent' ? 'webTorrentTransport' : 'gunTransport';
    setFeatureFlag(flagKey, enabled);
    setFlags(getFeatureFlags());
  };

  const getStateIcon = (state: P2PTransportStatus['state']) => {
    switch (state) {
      case 'ready':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'initializing':
        return <Radio className="h-4 w-4 animate-pulse text-blue-500" />;
      default:
        return <Radio className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStateBadge = (state: P2PTransportStatus['state']) => {
    switch (state) {
      case 'ready':
        return <Badge variant="default" className="bg-green-500/10 text-green-500">Ready</Badge>;
      case 'error':
        return <Badge variant="destructive">Error</Badge>;
      case 'initializing':
        return <Badge variant="secondary">Initializing</Badge>;
      default:
        return <Badge variant="outline">Idle</Badge>;
    }
  };

  const peerjsTransport = transports.find((t) => t.id === 'peerjs');
  const webtorrentTransport = transports.find((t) => t.id === 'webtorrent');
  const gunTransport = transports.find((t) => t.id === 'gun');

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Transport Layer Controls</h3>
          <p className="text-sm text-muted-foreground">
            Toggle experimental transport fallback mechanisms for P2P connectivity testing
          </p>
        </div>

        {/* PeerJS (Primary) */}
        <div className="space-y-3 border-b pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {peerjsTransport && getStateIcon(peerjsTransport.state)}
              <div>
                <Label className="text-base font-medium">PeerJS (Primary)</Label>
                <p className="text-xs text-muted-foreground">
                  WebRTC signaling via cloud infrastructure
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {peerjsTransport && getStateBadge(peerjsTransport.state)}
              {peerjsTransport && peerjsTransport.connectedPeers > 0 && (
                <Badge variant="outline">
                  {peerjsTransport.connectedPeers} peer{peerjsTransport.connectedPeers !== 1 ? 's' : ''}
                </Badge>
              )}
            </div>
          </div>
          {peerjsTransport?.lastError && (
            <div className="rounded-md bg-red-500/10 p-2 text-xs text-red-500">
              {peerjsTransport.lastError}
            </div>
          )}
        </div>

        {/* WebTorrent */}
        <div className="space-y-3 border-b pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {webtorrentTransport && getStateIcon(webtorrentTransport.state)}
              <div>
                <Label htmlFor="webtorrent-toggle" className="text-base font-medium">
                  WebTorrent Bridge
                </Label>
                <p className="text-xs text-muted-foreground">
                  Experimental: DHT-based peer discovery fallback
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {webtorrentTransport && (
                <>
                  {getStateBadge(webtorrentTransport.state)}
                  {webtorrentTransport.fallbackCount > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {webtorrentTransport.fallbackCount} fallback{webtorrentTransport.fallbackCount !== 1 ? 's' : ''}
                    </Badge>
                  )}
                  {webtorrentTransport.connectedPeers > 0 && (
                    <Badge variant="outline">
                      {webtorrentTransport.connectedPeers} peer{webtorrentTransport.connectedPeers !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </>
              )}
              <Switch
                id="webtorrent-toggle"
                checked={flags.webTorrentTransport}
                onCheckedChange={(checked) => handleToggleTransport('webtorrent', checked)}
              />
            </div>
          </div>
          {webtorrentTransport?.lastError && (
            <div className="rounded-md bg-red-500/10 p-2 text-xs text-red-500">
              {webtorrentTransport.lastError}
            </div>
          )}
        </div>

        {/* GUN */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {gunTransport && getStateIcon(gunTransport.state)}
              <div>
                <Label htmlFor="gun-toggle" className="text-base font-medium">
                  GUN Overlay
                </Label>
                <p className="text-xs text-muted-foreground">
                  Experimental: Graph database sync layer
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {gunTransport && (
                <>
                  {getStateBadge(gunTransport.state)}
                  {gunTransport.fallbackCount > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {gunTransport.fallbackCount} fallback{gunTransport.fallbackCount !== 1 ? 's' : ''}
                    </Badge>
                  )}
                  {gunTransport.connectedPeers > 0 && (
                    <Badge variant="outline">
                      {gunTransport.connectedPeers} peer{gunTransport.connectedPeers !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </>
              )}
              <Switch
                id="gun-toggle"
                checked={flags.gunTransport}
                onCheckedChange={(checked) => handleToggleTransport('gun', checked)}
              />
            </div>
          </div>
          {gunTransport?.lastError && (
            <div className="rounded-md bg-red-500/10 p-2 text-xs text-red-500">
              {gunTransport.lastError}
            </div>
          )}
        </div>

        {/* Telemetry Info */}
        <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          <p className="font-medium mb-1">About Transport Fallbacks:</p>
          <p>
            When PeerJS connections fail or timeout, enabled fallback transports will automatically
            attempt delivery. This provides resilience but may impact performance.
          </p>
        </div>
      </div>
    </Card>
  );
}
