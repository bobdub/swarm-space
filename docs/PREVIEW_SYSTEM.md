# Preview & Share Link System

## Overview

The Preview System enables safe, controlled content discovery across the decentralized P2P network through temporary, sandboxed connections. Users can share posts and profile feeds via dynamic links that establish preview-only P2P connections.

## Architecture

### Core Components

#### 1. Preview Mode Detection (`src/lib/preview/previewMode.ts`)
- Parses URL parameters for preview mode
- Manages preview sessions in sessionStorage
- Generates shareable links for posts and profiles
- Handles referral reward logic

#### 2. Preview Context (`src/contexts/PreviewContext.tsx`)
- Global state management for preview mode
- Establishes temporary P2P connections
- Awards referral rewards on signup
- Provides preview session data to components

#### 3. Preview Banner (`src/components/PreviewBanner.tsx`)
- Fixed banner displayed during preview mode
- Clear indication user is in sandboxed environment
- Signup CTA and exit option

#### 4. Preview Page (`src/pages/Preview.tsx`)
- Sandboxed view for shared content
- Displays single post or profile feed
- Prominent signup prompts
- Restricted navigation

#### 5. Share Button (`src/components/ShareButton.tsx`)
- Generates share links with creator's peerID
- Copy to clipboard functionality
- Native share API integration
- Displayed on posts and profiles

## URL Structure

### Post Share Link
```
https://swarm-space.lovable.app/?peerID={creatorPeerId}-preview&postID={postId}
```

Example:
```
https://swarm-space.lovable.app/?peerID=peer-abc123-preview&postID=post-xyz789
```

### Profile Feed Share Link
```
https://swarm-space.lovable.app/?peerID={creatorPeerId}-preview
```

Example:
```
https://swarm-space.lovable.app/?peerID=peer-abc123-preview
```

### URL Parameters

- `peerID`: Creator's peer ID with `-preview` suffix
- `postID` (optional): Specific post ID to preview

## Preview Session Flow

### 1. User Opens Share Link

```typescript
// URL: /?peerID=peer-abc123-preview&postID=post-xyz789
const session = parsePreviewMode();
// {
//   creatorPeerId: 'peer-abc123',
//   postId: 'post-xyz789',
//   isProfileFeed: false,
//   startedAt: '2025-01-15T10:30:00Z',
//   referralSource: 'peer-abc123-preview'
// }
```

### 2. Temporary P2P Connection

```typescript
// PreviewContext establishes temporary connection
if (p2p.isEnabled) {
  p2p.connectToPeer(session.creatorPeerId, {
    manual: true,
    source: 'preview-mode',
  });
}
```

**Key Points:**
- Connection is **temporary** and **isolated**
- Not added to permanent auto-connect list
- Only connects to creator's peer
- No mesh topology changes
- Minimal data exchange

### 3. Sandboxed Content Access

Users can only:
- View the specific shared post
- View recent posts in profile feed (limited)
- See creator's profile information

Users **cannot**:
- Browse the network
- Navigate to other content
- Access global feeds
- Interact with other users
- Leave comments or reactions (must sign up)

### 4. Signup & Referral Reward

When user signs up during preview:

```typescript
// Automatic referral tracking
await awardReferralReward({
  creatorUserId: 'user-abc',
  creatorPeerId: 'peer-abc123',
  newUserId: 'user-new',
  referralType: 'post', // or 'profile'
  referredPostId: 'post-xyz789'
});

// Creator receives: 5 SWARM credits
```

### 5. Exit Preview Mode

```typescript
// User exits preview
clearPreviewSession();
// - Session cleared from sessionStorage
// - URL parameters removed
// - Temporary connection closed
// - Returns to normal navigation
```

## Security & Privacy

### Sandboxing

Preview mode operates in a fully isolated environment:

```typescript
// Preview session stored in sessionStorage (tab-isolated)
sessionStorage.setItem('preview:current-session', JSON.stringify(session));

// No persistent storage
// No cross-tab contamination
// Clears on tab close
```

### Connection Safety

- **Read-only access**: Preview connections cannot modify data
- **No broadcast**: Preview peers don't relay messages
- **Temporary only**: Connections close when session ends
- **No peer discovery**: Preview peers invisible to mesh

### Data Minimization

Only essential data is exchanged:
- Post content (if post preview)
- Recent posts (if profile preview, limited to 10)
- Creator's profile metadata
- No private information
- No network topology data

## Referral System

### Reward Structure

| Action | Reward | Recipient |
|--------|--------|-----------|
| New user signup via post share | 5 SWARM | Post creator |
| New user signup via profile share | 5 SWARM | Profile owner |

### Tracking

```typescript
interface ReferralReward {
  id: string;
  creatorUserId: string;    // Who gets rewarded
  creatorPeerId: string;    // P2P identifier
  newUserId: string;        // Who signed up
  referralType: 'post' | 'profile';
  referredPostId?: string;  // If post referral
  credits: number;          // 5 SWARM
  awardedAt: string;        // Timestamp
}
```

### Deduplication

- One reward per unique referral
- Tracked by creatorPeerId + newUserId combination
- Prevents duplicate rewards if user opens link multiple times

## Integration Points

### PostCard Component

```tsx
<ShareButton 
  type="post" 
  postId={post.id} 
  variant="ghost" 
  size="sm" 
/>
```

### Profile Page

```tsx
<ShareButton 
  type="profile" 
  variant="outline" 
  size="sm" 
  showLabel 
/>
```

### App-Level Wrapper

```tsx
<PreviewProvider>
  <BrowserRouter>
    <PreviewBanner />
    <AppContent />
  </BrowserRouter>
</PreviewProvider>
```

## User Experience

### For Content Creators

1. Click share button on post/profile
2. Copy generated link
3. Share via any channel (social media, messaging, etc.)
4. Earn 5 SWARM credits per signup

### For Preview Visitors

1. Click shared link
2. See preview banner indicating sandboxed mode
3. View shared content
4. Prompted to sign up for full access
5. Exit anytime or sign up

### For New Users via Preview

1. Arrive via share link
2. View preview content
3. Click "Sign Up" button
4. Complete registration
5. Creator automatically rewarded
6. Preview mode exits
7. Full network access granted

## Technical Implementation

### Share Link Generation

```typescript
// For posts
function generatePostShareLink(postId: string, creatorPeerId: string): string {
  return `${window.location.origin}/?peerID=${creatorPeerId}-preview&postID=${postId}`;
}

// For profiles
function generateProfileShareLink(creatorPeerId: string): string {
  return `${window.location.origin}/?peerID=${creatorPeerId}-preview`;
}
```

### Preview Mode Check

```typescript
function isInPreviewMode(): boolean {
  const session = getPreviewSession();
  return session !== null;
}
```

### Conditional Rendering

```tsx
const { isPreviewMode, previewSession } = usePreview();

if (isPreviewMode) {
  // Show limited preview UI
  return <Preview />;
}

// Show full app UI
return <FullApp />;
```

## Analytics & Monitoring

### Trackable Metrics

- Preview link clicks
- Preview session duration
- Conversion rate (preview → signup)
- Referral rewards earned
- Most shared content
- Preview bounce rate

### Event Emissions

```typescript
// Preview started
window.dispatchEvent(new CustomEvent('preview-started', { 
  detail: { session } 
}));

// Referral reward
window.dispatchEvent(new CustomEvent('referral-reward', { 
  detail: { reward } 
}));
```

## Best Practices

### For Users

- Share links freely - they're safe and sandboxed
- Check your wallet for referral rewards
- Share your best content for maximum reach

### For Developers

- Always check `isPreviewMode` before showing privileged features
- Never expose write operations in preview mode
- Keep preview sessions short-lived
- Monitor referral fraud patterns

## Future Enhancements

### Planned Features

- [ ] Preview analytics dashboard for creators
- [ ] Custom preview durations (15m, 1h, 24h)
- [ ] Password-protected shares
- [ ] Expiring share links
- [ ] Preview quotas (limit concurrent previews)
- [ ] Rich preview embeds (Open Graph metadata)
- [ ] QR code generation for share links
- [ ] Preview link customization (branded URLs)

### Security Improvements

- [ ] Rate limiting on preview link generation
- [ ] CAPTCHA for suspicious preview access patterns
- [ ] IP-based abuse detection
- [ ] Preview access logs for creators

## Troubleshooting

### Preview Mode Not Activating

**Symptom:** URL has preview parameters but preview mode doesn't activate

**Solutions:**
1. Check URL format: Must end with `-preview`
2. Verify sessionStorage is available
3. Check browser console for errors
4. Ensure PreviewProvider is wrapping app

### Temporary Connection Not Establishing

**Symptom:** Preview content doesn't load

**Solutions:**
1. Verify P2P is enabled
2. Check creator's peer is online
3. Wait 5-10 seconds for connection
3. Try refreshing the page

### Referral Reward Not Awarded

**Symptom:** Creator doesn't receive credits after signup

**Solutions:**
1. Verify user completed full signup
2. Check if reward was already claimed
3. Ensure creator's user ID is correct
4. Check creditTransactions store

## API Reference

### Preview Functions

```typescript
// Parse preview from URL
parsePreviewMode(): PreviewSession | null

// Check if in preview mode
isInPreviewMode(): boolean

// Get current session
getPreviewSession(): PreviewSession | null

// Start preview
startPreviewSession(session: PreviewSession): void

// Clear preview
clearPreviewSession(): void

// Generate links
generatePostShareLink(postId: string, peerId: string): string
generateProfileShareLink(peerId: string): string

// Award referral
awardReferralReward(params: ReferralParams): Promise<ReferralReward>

// Get user's referrals
getReferralRewards(userId: string): Promise<ReferralReward[]>
```

### React Hooks

```typescript
// Use preview context
const { isPreviewMode, previewSession, exitPreview } = usePreview();
```

## Conclusion

The Preview System successfully enables safe content sharing across the decentralized network while maintaining security, privacy, and mesh integrity. It provides a frictionless path for new user acquisition through referral incentives while keeping the network protected from abuse.
