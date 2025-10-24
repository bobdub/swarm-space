# Phase 3: User Profiles & Social Features
**Duration:** 5-7 days  
**Status:** Ready to Begin 🚀

---

## Overview

Phase 3 transforms the Imagination Network from a personal tool into a social platform. We'll build out user profiles, social interactions (likes, comments, reactions), and discovery features (search, tags, trending).

**Philosophy:** Local-first social. All interactions stored locally, prepared for future P2P sync.

---

## Sprint Breakdown

### Sprint 1: User Profiles (Days 1-2)
**Goal:** Rich user profiles with customization

#### 1.1 Profile Data Model
```typescript
// Extend User interface in src/types/index.ts
interface UserProfile {
  bio: string;
  avatarRef?: string; // Reference to encrypted avatar in manifests
  bannerRef?: string;
  location?: string;
  website?: string;
  links?: {
    github?: string;
    twitter?: string;
    custom?: { label: string; url: string }[];
  };
  stats?: {
    postCount: number;
    projectCount: number;
    joinedAt: string;
  };
}
```

#### 1.2 Profile Page Component
**File:** `src/pages/Profile.tsx`
- Route: `/u/:username` and `/profile` (own profile)
- Sections:
  - Header with avatar, banner, bio
  - Stats bar (posts, projects, joined date)
  - Tab navigation (Posts, Projects, About)
  - Edit button (own profile only)
- Design: Match existing aesthetic with gradient borders

#### 1.3 Profile Editor
**File:** `src/components/ProfileEditor.tsx`
- Modal or separate page
- Fields: Display name, username, bio, avatar upload
- Avatar encryption using existing file system
- Real-time preview
- Save to IndexedDB

#### 1.4 Profile Navigation
- Add profile link to `Navigation.tsx`
- Add profile dropdown to `TopNavigationBar.tsx`
- Link author names in posts to profiles

**Deliverables:**
- [ ] Profile page UI
- [ ] Profile editor component
- [ ] Avatar upload & encryption
- [ ] Profile routes in App.tsx
- [ ] Navigation integration

---

### Sprint 2: Social Interactions (Days 3-4)
**Goal:** Enable likes, comments, and reactions

#### 2.1 Emoji Reaction System 🆕
**Updated approach:** Dynamic emoji reactions instead of basic likes

```typescript
// Add to src/types/index.ts
interface Reaction {
  userId: string;
  emoji: string; // Any emoji: "❤️", "🔥", "💡", "🚀", etc.
  createdAt: string;
}

// Future: Credit/Hype System (Phase 4+)
interface PostCredit {
  userId: string;
  amount: number;
  createdAt: string;
}

interface Comment {
  id: string;
  postId: string;
  author: string;
  authorName?: string;
  text: string;
  reactions?: Reaction[];
  parentId?: string; // For threading
  createdAt: string;
}
```

#### 2.2 Post Interactions
**Update:** `src/components/PostCard.tsx`
- Emoji reaction picker (any emoji)
- Display reaction counts grouped by emoji
- Comment button opens thread
- Share button (copy link, future P2P share)
- Store reactions in post object

**New:** `src/components/ReactionPicker.tsx`
- Emoji picker interface
- Quick reactions bar (customizable favorites)
- Display all reactions on post
- Group by emoji with counts

**New:** `src/components/CommentThread.tsx`
- Display comments under posts
- Comment input with user avatar
- Nested replies (1 level deep)
- Delete own comments
- Comment reactions

#### 2.3 Interaction Library
**File:** `src/lib/interactions.ts`
```typescript
export async function addReaction(postId: string, type: string): Promise<void>
export async function removeReaction(postId: string, userId: string): Promise<void>
export async function addComment(postId: string, comment: Comment): Promise<void>
export async function deleteComment(commentId: string): Promise<void>
export async function getComments(postId: string): Promise<Comment[]>
```

#### 2.4 Notifications System
**Update:** `src/pages/Notifications.tsx`
- Load notifications from IndexedDB
- Types: new comment, new reaction, mention
- Mark as read functionality
- Group by date
- Real-time updates (local only for now)

**New:** `src/lib/notifications.ts`
```typescript
interface Notification {
  id: string;
  userId: string; // recipient
  type: "comment" | "reaction" | "mention" | "project_invite";
  sourceId: string; // post/project ID
  actorId: string; // who did the action
  actorName: string;
  text: string;
  read: boolean;
  createdAt: string;
}
```

**Deliverables:**
- [ ] Like/reaction system working
- [ ] Comment thread component
- [ ] Comment persistence
- [ ] Notifications page functional
- [ ] Notification badge on nav

---

### Sprint 3: Search & Discovery (Days 5-7)
**Goal:** Help users find content and people

#### 3.1 Tag System
**Update:** `src/types/index.ts`
```typescript
// Add to Post interface
tags?: string[];

// New type
interface Tag {
  name: string;
  postCount: number;
  lastUsed: string;
}
```

**Update:** `src/pages/Create.tsx`
- Tag input field (comma-separated or chip UI)
- Auto-suggest existing tags
- Max 10 tags per post

**New:** `src/lib/tags.ts`
- Extract tags from posts
- Get trending tags (most used this week)
- Get tag counts

#### 3.2 Search Component
**New:** `src/components/SearchBar.tsx`
- Full-text search across posts, projects, users
- Filter by type (posts/projects/people)
- Search history (local)
- Keyboard shortcuts (cmd+k)

**New:** `src/lib/search.ts`
```typescript
export async function searchPosts(query: string): Promise<Post[]>
export async function searchProjects(query: string): Promise<Project[]>
export async function searchUsers(query: string): Promise<User[]>
export async function searchAll(query: string): Promise<SearchResults>
```

#### 3.3 Explore Page Enhancement
**Update:** `src/pages/Explore.tsx`
- Trending tags section
- Top posts this week
- Active projects
- New users (if applicable)
- Category filters
- Random discovery ("Surprise me")

#### 3.4 Feed Filtering
**Update:** `src/pages/Index.tsx`
- "Trending" tab: Sort by engagement (likes + comments)
- "Videos" tab: Filter by type === "video"
- "Recent" tab: Already working
- Add "Following" tab (placeholder for Phase 5)

**Deliverables:**
- [ ] Tag system implemented
- [ ] Search bar component
- [ ] Search functionality working
- [ ] Explore page populated
- [ ] Feed filtering complete

---

## Database Schema Updates

### New Object Stores
```typescript
// Add to src/lib/store.ts in onupgradeneeded
if (!db.objectStoreNames.contains("comments")) {
  const commentStore = db.createObjectStore("comments", { keyPath: "id" });
  commentStore.createIndex("postId", "postId", { unique: false });
  commentStore.createIndex("author", "author", { unique: false });
}

if (!db.objectStoreNames.contains("notifications")) {
  const notifStore = db.createObjectStore("notifications", { keyPath: "id" });
  notifStore.createIndex("userId", "userId", { unique: false });
  notifStore.createIndex("read", "read", { unique: false });
}

if (!db.objectStoreNames.contains("tags")) {
  db.createObjectStore("tags", { keyPath: "name" });
}

// Increment DB_VERSION to 3
```

### Updated Post Schema
```typescript
interface Post {
  // ... existing fields
  reactions: Reaction[];
  commentCount: number;
  tags: string[];
  editedAt?: string;
}
```

---

## UI Components to Create

1. **ProfileHeader** - Banner, avatar, bio, stats
2. **ProfileEditor** - Modal for editing profile
3. **CommentThread** - Display comments under posts
4. **CommentInput** - Write new comments
5. **ReactionPicker** - Choose reaction type
6. **NotificationCard** - Display notification item
7. **SearchBar** - Global search input
8. **SearchResults** - Display search results
9. **TagChip** - Clickable tag badge
10. **TrendingTags** - List of trending tags
11. **UserCard** - Mini profile card for search results

---

## Success Metrics

### User Profiles
- [ ] Can create and edit profile
- [ ] Can upload encrypted avatar
- [ ] Profile page displays user content
- [ ] Can navigate to profiles from posts

### Social Interactions
- [ ] Can like/unlike posts
- [ ] Can write and view comments
- [ ] Can reply to comments
- [ ] Notifications appear for interactions
- [ ] Notification badge updates

### Search & Discovery
- [ ] Can search posts by content
- [ ] Can search users by name
- [ ] Tags appear on posts
- [ ] Can filter by tags
- [ ] Trending tags display
- [ ] Feed filtering works (trending, videos)

---

## Technical Considerations

### Performance
- Implement virtual scrolling for long comment threads
- Cache search results temporarily
- Index posts by tags for fast filtering
- Debounce search input

### Privacy
- All social data stored locally (no server)
- Reactions/comments encrypted at rest (future)
- User controls who sees profile (future setting)

### Future P2P Prep
- Assign unique IDs to all interactions (UUID v4)
- Include timestamps for conflict resolution
- Design for eventual consistency
- Sign all user actions (comments, reactions)

---

## Optional Enhancements (If Time Allows)

1. **Rich Text Editor** - Markdown support in posts/comments
2. **Emoji Picker** - Custom emoji reactions
3. **Mentions** - @username mentions with autocomplete
4. **Hashtag Linking** - #tag automatically links to tag page
5. **Post Editing** - Edit posts after publishing
6. **Post Deletion** - Delete own posts
7. **User Blocking** - Hide posts from specific users (local)
8. **Bookmarks** - Save favorite posts

---

## Testing Checklist

- [ ] Create profile with avatar
- [ ] Edit profile multiple times
- [ ] Like/unlike posts
- [ ] Write comments
- [ ] Reply to comments
- [ ] Delete own comments
- [ ] Receive notifications
- [ ] Search for posts
- [ ] Search for users
- [ ] Filter by tags
- [ ] View trending content
- [ ] Navigate between profiles
- [ ] All interactions persist after reload

---

## Next Phase Preview

**Phase 4: Group Encryption & Shared Projects**
- Project-level encryption keys
- Invite members to projects
- Project-scoped chat
- Shared task boards
- Access control lists

---

## Ready to Begin? 🚀

Phase 3 will make the Imagination Network feel like a real social platform while maintaining the local-first, privacy-focused architecture. Let's build it!
