# Mobile App Setup Guide

## Overview

This guide will help you build and deploy the Swarm Space mobile app with enhanced background persistence for P2P nodes.

---

## Prerequisites

### For iOS Development
- macOS computer
- Xcode 14+ installed
- Apple Developer account (for device testing)
- CocoaPods installed (`sudo gem install cocoapods`)

### For Android Development
- Android Studio installed
- Java Development Kit (JDK) 11+
- Android SDK with API level 22+

---

## Initial Setup

### 1. Export and Clone Repository

1. In Lovable, click the **GitHub** button in top right
2. Export project to your GitHub account
3. Clone to your local machine:
   ```bash
   git clone <your-repo-url>
   cd swarm-space
   ```

### 2. Install Dependencies

```bash
npm install
```

### 3. Initialize Capacitor

```bash
npx cap init
```

This will use the existing `capacitor.config.ts` configuration.

### 4. Build the Web App

```bash
npm run build
```

---

## iOS Setup

### 1. Add iOS Platform

```bash
npx cap add ios
```

### 2. Update iOS Dependencies

```bash
npx cap update ios
```

### 3. Configure Background Modes

Open the iOS project:
```bash
npx cap open ios
```

In Xcode:
1. Select your app target
2. Go to **Signing & Capabilities**
3. Click **+ Capability** and add:
   - **Background Modes**
   - Enable: "Background fetch", "Remote notifications", "Background processing"

### 4. Update Info.plist

Add network permissions for P2P:
```xml
<key>NSLocalNetworkUsageDescription</key>
<string>Swarm Space needs local network access for peer-to-peer connections</string>
```

### 5. Run on Device/Simulator

```bash
npx cap run ios
```

---

## Android Setup

### 1. Add Android Platform

```bash
npx cap add android
```

### 2. Update Android Dependencies

```bash
npx cap update android
```

### 3. Configure Background Services

Open the Android project:
```bash
npx cap open android
```

In Android Studio, edit `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
```

### 4. Run on Device/Emulator

```bash
npx cap run android
```

---

## Development Workflow

### Hot Reload During Development

The app is configured to load from the Lovable sandbox URL for hot reload:
```
https://60db83b9-24c7-4fa3-823d-71fa3a29a5bc.lovableproject.com
```

This allows you to:
1. Make changes in Lovable
2. See updates instantly on your mobile device
3. No need to rebuild constantly

### Syncing Changes

When you pull new changes from GitHub:

```bash
git pull origin main
npm install
npm run build
npx cap sync
```

---

## Building for Production

### iOS Production Build

1. In Xcode, set build configuration to **Release**
2. Update `capacitor.config.ts` - remove `server.url`
3. Build and archive:
   ```bash
   npm run build
   npx cap sync ios
   npx cap open ios
   ```
4. In Xcode: **Product → Archive**
5. Submit to App Store Connect

### Android Production Build

1. Update `capacitor.config.ts` - remove `server.url`
2. Build release APK:
   ```bash
   npm run build
   npx cap sync android
   npx cap open android
   ```
3. In Android Studio: **Build → Generate Signed Bundle/APK**
4. Upload to Google Play Console

---

## Background Persistence Features

The mobile app includes enhancements for keeping P2P connections alive:

### App State Management
- Detects when app goes to background
- Maintains WebRTC connections during background state
- Automatically reconnects when network changes

### Network Monitoring
- Listens for network status changes
- Automatically reconnects P2P when network restored
- Gracefully handles connection interruptions

### Battery Optimization
- Reduces heartbeat frequency in background
- Batches sync operations
- Uses efficient WebRTC keep-alive

---

## Testing P2P on Mobile

1. **Enable P2P**: Open app → Settings → Enable P2P Node
2. **Verify Connection**: Check status indicator shows "Online"
3. **Background Test**: 
   - Enable P2P
   - Press home button (app to background)
   - Wait 5 minutes
   - Reopen app - should still show "Online"
4. **Network Switch Test**:
   - Enable P2P on WiFi
   - Switch to mobile data
   - App should auto-reconnect within 30s

---

## Troubleshooting

### iOS: WebRTC Not Working
- Ensure camera/microphone permissions added to Info.plist
- Check network permissions granted
- Verify background modes enabled

### Android: Connection Drops in Background
- Check battery optimization disabled for app
- Ensure wake lock permission granted
- Test with device plugged in first

### Both: Peer Discovery Fails
- Verify internet connection
- Check PeerJS signaling server is accessible
- Test in browser first to isolate issue

---

## Next Steps

- Test 24-hour background persistence
- Monitor battery usage
- Profile network bandwidth
- Consider adding foreground service notification (Android)
- Implement push notifications for important events

---

## Resources

- [Capacitor Documentation](https://capacitorjs.com/docs)
- [Capacitor App Plugin](https://capacitorjs.com/docs/apis/app)
- [Capacitor Network Plugin](https://capacitorjs.com/docs/apis/network)
- [P2P Protocol Documentation](./P2P_PROTOCOL.md)
