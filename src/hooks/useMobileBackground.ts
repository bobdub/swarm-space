import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';

/**
 * Hook to manage P2P connections during mobile app lifecycle events
 * Keeps connections alive when app goes to background
 */
export function useMobileBackground(
  onAppActive: () => void,
  onAppInactive: () => void,
  onNetworkChange: (connected: boolean) => void
) {
  useEffect(() => {
    let appStateHandle: any;
    let networkHandle: any;

    // Setup listeners
    const setupListeners = async () => {
      // Handle app state changes
      appStateHandle = await App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          console.log('[Mobile] App became active');
          onAppActive();
        } else {
          console.log('[Mobile] App went to background');
          onAppInactive();
        }
      });

      // Handle network status changes
      networkHandle = await Network.addListener('networkStatusChange', (status) => {
        console.log('[Mobile] Network status changed:', status.connected);
        onNetworkChange(status.connected);
      });

      // Check initial network status
      const status = await Network.getStatus();
      onNetworkChange(status.connected);
    };

    setupListeners();

    return () => {
      if (appStateHandle) appStateHandle.remove();
      if (networkHandle) networkHandle.remove();
    };
  }, [onAppActive, onAppInactive, onNetworkChange]);
}
