import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.60db83b924c74fa3823d71fa3a29a5bc',
  appName: 'swarm-space',
  webDir: 'dist',
  server: {
    url: 'https://60db83b9-24c7-4fa3-823d-71fa3a29a5bc.lovableproject.com?forceHideBadge=true',
    cleartext: true
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
