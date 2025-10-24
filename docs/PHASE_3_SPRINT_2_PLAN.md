# Phase 3 Sprint 2: Notifications & Social Polish
**Status:** 🚧 IN PROGRESS  
**Duration:** 2-3 days  
**Goal:** Complete social interactions with notifications system

---

## Overview

Sprint 2 completes the core social interaction loop:
1. User adds reaction/comment → **Notification generated**
2. Recipient sees notification → **Badge updates**
3. Recipient clicks notification → **Navigates to content**
4. Avatar images display properly → **Visual polish**

This sprint builds on Sprint 1 (profiles) and the in-progress work (reactions, comments).

---

## Sprint Goals

### Primary Objectives
- ✅ Emoji reaction system (COMPLETE)
- ✅ Comment threads (COMPLETE)  
- ✅ Profile linking (COMPLETE)
- 🎯 Notifications system (IN PROGRESS)
- 🎯 Avatar image display (IN PROGRESS)
- 🎯 Notification badge on navigation (TODO)

### Success Criteria
- User receives notification when someone reacts to their post
- User receives notification when someone comments on their post
- Unread notification count displays in navigation
- Clicking notification navigates to relevant post/comment
- Avatar images decrypt and display on profiles and posts
- System feels responsive and complete

---

## Implementation Plan

### Task 1: Notification Data Model & Generation

#### 1.1: Update Type Definitions
**File:** `src/types/index.ts`

```typescript
export interface Notification {
  id: string;
  userId: string;           // Recipient user ID
  type: 'reaction' | 'comment' | 'mention' | 'follow';
  triggeredBy: string;      // User who triggered the notification
  triggeredByName: string;  // Display name for UI
  postId?: string;          // For reactions/comments
  commentId?: string;       // For comment replies
  content?: string;         // Preview text (e.g., comment snippet)
  emoji?: string;           // For reaction notifications
  read: boolean;
  createdAt: string;
}
```

#### 1.2: Create Notification Utilities
**File:** `src/lib/notifications.ts`

```typescript
import { Notification } from '@/types';
import { put, getAll } from './store';
import { getCurrentUser } from './auth';

/**
 * Create a notification for a user
 */
export async function createNotification(
  notification: Omit<Notification, 'id' | 'createdAt' | 'read'>
): Promise<Notification> {
  const newNotification: Notification = {
    ...notification,
    id: crypto.randomUUID(),
    read: false,
    createdAt: new Date().toISOString(),
  };
  
  await put('notifications', newNotification);
  return newNotification;
}

/**
 * Get all notifications for current user
 */
export async function getNotifications(): Promise<Notification[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  
  const allNotifications = (await getAll('notifications')) as Notification[];
  return allNotifications
    .filter((n) => n.userId === user.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Get unread notification count
 */
export async function getUnreadCount(): Promise<number> {
  const notifications = await getNotifications();
  return notifications.filter((n) => !n.read).length;
}

/**
 * Mark notification as read
 */
export async function markAsRead(notificationId: string): Promise<void> {
  // Implementation
}

/**
 * Mark all notifications as read
 */
export async function markAllAsRead(): Promise<void> {
  // Implementation
}
```

#### 1.3: Integrate Notification Generation
**Files to modify:**
- `src/lib/interactions.ts` - Add notification creation in `addReaction()` and `addComment()`

```typescript
// In addReaction()
export async function addReaction(postId: string, emoji: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("User not authenticated");

  const post = (await get("posts", postId)) as Post;
  if (!post) throw new Error("Post not found");

  // ... existing reaction logic ...

  // Generate notification if not reacting to own post
  if (post.author !== user.id) {
    await createNotification({
      userId: post.author,
      type: 'reaction',
      triggeredBy: user.id,
      triggeredByName: user.displayName || user.username,
      postId,
      emoji,
    });
  }
}

// Similar for addComment()
```

---

### Task 2: Notifications Page

#### 2.1: Build Notifications Page
**File:** `src/pages/Notifications.tsx`

**Features:**
- Load notifications from IndexedDB
- Group by date (Today, Yesterday, This Week, Older)
- Display notification cards with:
  - Triggerer avatar + name
  - Notification type icon (❤️ for reactions, 💬 for comments)
  - Content preview
  - Timestamp (relative: "2h ago")
  - Read/unread indicator
- Click notification → navigate to post/comment
- Mark as read on click
- "Mark all as read" button

**UI Structure:**
```tsx
<div className="notifications-page">
  <header>
    <h1>Notifications</h1>
    <Button onClick={markAllAsRead}>Mark all as read</Button>
  </header>
  
  {groupedNotifications.map(group => (
    <section key={group.label}>
      <h2>{group.label}</h2>
      {group.notifications.map(notification => (
        <NotificationCard 
          key={notification.id}
          notification={notification}
          onClick={() => handleNotificationClick(notification)}
        />
      ))
    </section>
  ))}
</div>
```

---

### Task 3: Notification Badge

#### 3.1: Add Badge to Navigation
**File:** `src/components/Navigation.tsx` or `src/components/TopNavigationBar.tsx`

```tsx
import { useEffect, useState } from 'react';
import { getUnreadCount } from '@/lib/notifications';
import { Badge } from '@/components/ui/badge';

function NotificationBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const loadCount = async () => {
      const unread = await getUnreadCount();
      setCount(unread);
    };
    
    loadCount();
    
    // Poll for updates every 10 seconds (or use event listener)
    const interval = setInterval(loadCount, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative">
      <Bell className="h-5 w-5" />
      {count > 0 && (
        <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs">
          {count > 9 ? '9+' : count}
        </Badge>
      )}
    </div>
  );
}
```

---

### Task 4: Avatar Display & Polish

#### 4.1: Avatar Image Component
**File:** `src/components/Avatar.tsx` (new)

```tsx
import { useState, useEffect } from 'react';
import { Avatar as ShadcnAvatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { get } from '@/lib/store';
import { decryptAndReassembleFile } from '@/lib/fileEncryption';

interface AvatarProps {
  userId: string;
  userName?: string;
  avatarRef?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function UserAvatar({ userId, userName, avatarRef, size = 'md', className }: AvatarProps) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!avatarRef) {
      setLoading(false);
      return;
    }

    const loadAvatar = async () => {
      try {
        // Load manifest and decrypt avatar
        const manifest = await get('manifests', avatarRef);
        if (manifest) {
          // Decrypt file
          const blob = await decryptAndReassembleFile(manifest, /* fileKey */);
          const url = URL.createObjectURL(blob);
          setAvatarUrl(url);
        }
      } catch (error) {
        console.error('Failed to load avatar:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAvatar();

    return () => {
      if (avatarUrl) URL.revokeObjectURL(avatarUrl);
    };
  }, [avatarRef]);

  const initials = userName
    ?.split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';

  return (
    <ShadcnAvatar className={`${sizeClasses[size]} ${className}`}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt={userName} />}
      <AvatarFallback>{loading ? '...' : initials}</AvatarFallback>
    </ShadcnAvatar>
  );
}

const sizeClasses = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-16 w-16',
};
```

#### 4.2: Integrate Avatar Component
**Files to update:**
- `src/components/PostCard.tsx` - Replace avatar initials with `<UserAvatar />`
- `src/components/CommentThread.tsx` - Use `<UserAvatar />` for comment authors
- `src/pages/Profile.tsx` - Use `<UserAvatar />` for profile header

#### 4.3: Default Avatar Generation
For users without uploaded avatars, generate colored avatars based on initials:
- Hash username → deterministic color
- Display initials on colored background
- Consistent across app

---

### Task 5: Polish & Testing

#### 5.1: UI/UX Polish
- Add skeleton loading states for notifications
- Smooth transitions for notification badge updates
- Empty state for "No notifications yet"
- Success toast when marking as read

#### 5.2: Testing Checklist
- [ ] Create post → React with emoji → Author receives notification
- [ ] Comment on post → Author receives notification
- [ ] Notification badge shows correct unread count
- [ ] Click notification → Navigate to post
- [ ] Mark as read → Badge count decreases
- [ ] Mark all as read → Badge shows 0
- [ ] Avatar uploads and displays correctly
- [ ] Default avatar shows initials with color
- [ ] Profile page avatar matches post avatar

---

## Data Model Changes

### IndexedDB Schema Update
**File:** `src/lib/store.ts`

```typescript
// In upgrade handler
if (!db.objectStoreNames.contains("notifications")) {
  const notificationStore = db.createObjectStore("notifications", { keyPath: "id" });
  notificationStore.createIndex("userId", "userId", { unique: false });
  notificationStore.createIndex("read", "read", { unique: false });
  notificationStore.createIndex("createdAt", "createdAt", { unique: false });
}
```

---

## Dependencies

No new dependencies required. All features use existing libraries:
- `lucide-react` for icons (Bell, Heart, MessageCircle)
- `date-fns` for relative timestamps
- Existing shadcn/ui components

---

## Success Criteria

### Functional Requirements
- [x] Reactions generate notifications
- [x] Comments generate notifications
- [ ] Notifications page displays all activity
- [ ] Notification badge shows unread count
- [ ] Clicking notification navigates to content
- [ ] Marking as read works correctly
- [ ] Avatar images decrypt and display
- [ ] Default avatars show for users without images

### Performance Requirements
- Notification loading < 100ms for 50 notifications
- Badge updates within 1 second of new notification
- Avatar decryption doesn't block UI

### UX Requirements
- Notifications feel instant and responsive
- Clear visual distinction between read/unread
- Intuitive navigation from notification to content
- Graceful fallback for missing avatars

---

## Future Enhancements (Post-Sprint 2)

1. **Real-time Notifications:**
   - WebSocket or polling for instant updates
   - Service Worker for background notifications

2. **Notification Preferences:**
   - Mute specific users/posts
   - Notification type filtering
   - Email digest (if server added)

3. **Rich Notifications:**
   - Inline reply to comments
   - Quick react from notification
   - Notification grouping ("Alice and 3 others reacted")

4. **Mention System:**
   - @username mentions in comments
   - Mention notifications
   - Autocomplete mention picker

---

## Timeline

### Day 1: Notifications System
- Morning: Data model + notification generation
- Afternoon: Notifications page UI
- Evening: Notification badge integration

### Day 2: Avatar & Polish
- Morning: Avatar component + decryption
- Afternoon: Integrate avatars across app
- Evening: Default avatar generation

### Day 3: Testing & Refinement
- Morning: End-to-end testing
- Afternoon: UI polish and animations
- Evening: Documentation updates

---

## Next Steps After Sprint 2

Once Sprint 2 is complete:
→ **Sprint 3:** Search & Discovery
- Full-text search across posts
- Tag system for categorization
- Trending tags display
- User search functionality

---

**Let's complete the social interaction loop! 🚀**
