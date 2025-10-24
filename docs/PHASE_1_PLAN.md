# Phase 1: Content Creation & Management
**Status:** 🚧 IN PROGRESS  
**Goal:** Enable full content creation with encrypted file storage

---

## Overview
Phase 1 focuses on making the app fully functional for local content creation. Users will be able to upload files (images, videos, documents), create posts with attachments, and view their content in an encrypted, offline-first environment.

---

## Sprint 1: File Chunking & Encryption 

### Task 1.1: Implement File Encryption Module
**Files:** `src/lib/fileEncryption.ts`

**Functions to implement:**
```typescript
// Generate a random file key
async function genFileKey(): Promise<CryptoKey>

// Export key to base64
async function exportKeyRaw(key: CryptoKey): Promise<string>

// Import key from base64
async function importKeyRaw(b64: string): Promise<CryptoKey>

// Chunk and encrypt a file
async function chunkAndEncryptFile(
  file: File, 
  fileKey: CryptoKey, 
  chunkSize?: number
): Promise<Manifest>

// Decrypt and reassemble chunks
async function decryptAndReassembleFile(
  manifest: Manifest,
  fileKey: CryptoKey
): Promise<Blob>
```

**Technical details:**
- Chunk size: 64KB (configurable)
- Each chunk gets unique IV (12 bytes for AES-GCM)
- Compute chunk ref as SHA-256 hash of (cipher + seq)
- Store chunks in IndexedDB `chunks` store
- Create manifest with ordered chunk refs
- Store manifest in IndexedDB `manifests` store

**Testing:**
- Unit test: encrypt/decrypt round-trip
- Test with 1MB, 10MB, 100MB files
- Verify chunk refs are unique and reproducible

---

### Task 1.2: File Upload UI Component
**Files:** `src/components/FileUpload.tsx`

**Features:**
- Drag-and-drop zone
- File type validation (images, videos, PDFs, etc.)
- Upload progress indicator per file
- Preview thumbnails for images
- List of uploaded files with size
- Remove file before submitting
- Max file size warning (suggest 100MB limit for UX)

**Props interface:**
```typescript
interface FileUploadProps {
  onFilesReady: (manifests: Manifest[]) => void;
  maxFiles?: number;
  maxFileSize?: number;
  acceptedTypes?: string[];
}
```

**UI/UX:**
- Show encryption progress: "Encrypting... 45%"
- Show chunk upload progress: "Storing chunk 12/87"
- Toast on completion: "File encrypted and stored locally"

---

### Task 1.3: Manifest Viewer Page
**Files:** `src/pages/Files.tsx`

**Features:**
- List all manifests from IndexedDB
- Display: filename, size, type (MIME), created date
- Action buttons: Preview, Download, Delete
- Filter by type (images, videos, documents, all)
- Search by filename
- Storage usage indicator

**Route:** `/files`  
**Add to Navigation:** Insert "Files" link in sidebar

---

### Task 1.4: File Preview/Download
**Files:** `src/components/FilePreview.tsx`

**Features:**
- Decrypt file on-demand (don't keep decrypted in memory)
- Image preview: inline image viewer with zoom
- Video preview: HTML5 video player
- PDF preview: embed or link to download
- Download button: decrypt and trigger browser download
- Loading state during decryption

---

## Sprint 2: Rich Posts & Feed 

### Task 2.1: Enhance Create Post Page
**Files:** `src/pages/Create.tsx`

**Updates:**
- Integrate `FileUpload` component
- Support text + multiple file attachments
- Show attached files with previews
- Post preview panel
- Character count for text content
- Post to personal feed or project feed (dropdown)
- Store post in IndexedDB with manifest refs

**Post structure:**
```typescript
interface Post {
  id: string;
  author: string; // userId
  projectId: string | null;
  type: 'text' | 'image' | 'video' | 'file' | 'link';
  content: string;
  manifestIds: string[]; // references to stored files
  createdAt: string;
  updatedAt: string;
}
```

---

### Task 2.2: Real Feed on Index Page
**Files:** `src/pages/Index.tsx`

**Updates:**
- Load posts from IndexedDB `posts` store
- Sort by `createdAt` (most recent first)
- Render `PostCard` for each post
- Load manifest metadata for file attachments
- Show image thumbnails, video previews inline
- Implement infinite scroll (load 20 posts at a time)

**Performance:**
- Use React Query or SWR for caching
- Virtualize long lists (react-window)
- Lazy load images (Intersection Observer)

---

### Task 2.3: Post Filtering & Trending
**Files:** `src/pages/Index.tsx`, `src/lib/feedAlgorithm.ts`

**Filtering tabs:**
- All
- Images (posts with image manifests)
- Videos (posts with video manifests)
- Links (external links)

**Trending algorithm (local):**
- Track views, likes (placeholder for now)
- Score: `(views * 1 + likes * 5) / age_in_hours`
- Store engagement in IndexedDB `meta` store
- Display "Trending" section in right rail

---

### Task 2.4: Post Interactions (Placeholder)
**Files:** `src/components/PostCard.tsx`

**Add buttons:**
- Like (increment count, store in IndexedDB)
- Comment (open modal, store comments in post)
- Share (copy post link, future P2P share)

**Note:** Full social features come in Phase 3; this is basic local tracking.

---

## Sprint 3: Project Management 

### Task 3.1: Project Creation Flow
**Files:** `src/pages/Projects.tsx`, `src/components/CreateProjectModal.tsx`

**Features:**
- Modal or page to create new project
- Fields: name, description, members (local users)
- Generate project ID
- Store in IndexedDB `projects` store
- Navigate to project detail page after creation

---

### Task 3.2: Project Detail Page
**Files:** `src/pages/ProjectDetail.tsx`

**Route:** `/project/:projectId`

**Features:**
- Project header: name, description, progress bar
- Member avatars
- Tabs: Feed | Planner | Tasks | Files | Members
- Feed tab: posts scoped to this project
- Planner tab: placeholder (Phase 2)
- Tasks tab: kanban board scoped to project
- Files tab: manifests tagged with projectId
- Members tab: list members, add/remove (local only)

---

### Task 3.3: Project-Scoped Posts
**Files:** `src/pages/Create.tsx`, `src/pages/ProjectDetail.tsx`

**Updates:**
- When creating post, select project from dropdown
- Store `projectId` in post
- Filter posts by `projectId` on project feed tab
- Show project badge on posts in main feed

---

## Deliverables Checklist

### Code Deliverables
- [ ] `src/lib/fileEncryption.ts` - File chunking and encryption
- [ ] `src/components/FileUpload.tsx` - Upload UI component
- [ ] `src/components/FilePreview.tsx` - Preview/download component
- [ ] `src/pages/Files.tsx` - File management page
- [ ] `src/pages/Create.tsx` - Enhanced post creation
- [ ] `src/pages/Index.tsx` - Real feed with filtering
- [ ] `src/pages/Projects.tsx` - Project listing page
- [ ] `src/pages/ProjectDetail.tsx` - Project detail page
- [ ] `src/components/CreateProjectModal.tsx` - Project creation UI
- [ ] `src/lib/feedAlgorithm.ts` - Trending and filtering logic

### Documentation
- [ ] Update README with Phase 1 features
- [ ] Add file encryption flow diagram
- [ ] Document manifest structure
- [ ] Write user guide for file uploads

### Testing
- [ ] Unit tests for fileEncryption module
- [ ] Integration test: upload -> encrypt -> store -> decrypt -> download
- [ ] Test with various file types and sizes
- [ ] Test error handling (quota exceeded, large files)

---

## Known Challenges & Mitigations

**Challenge 1: Browser storage quotas**
- **Issue:** IndexedDB has browser-specific limits (usually 50-500 MB)
- **Mitigation:** 
  - Warn users when approaching quota
  - Implement file deletion with storage reclaim
  - Suggest browser settings to increase quota

**Challenge 2: Large file memory usage**
- **Issue:** Loading large files into memory for encryption can freeze UI
- **Mitigation:**
  - Use streaming encryption with File.stream()
  - Process in Web Worker (Phase 6)
  - Show progress indicators
  - Chunk uploads in background

**Challenge 3: File type detection**
- **Issue:** MIME types not always reliable
- **Mitigation:**
  - Use File.type from browser
  - Fallback to extension-based detection
  - Store original filename in chunk metadata

---

## Success Criteria
- ✅ User can upload a 5MB image, see it encrypted and stored
- ✅ User can create a post with text + 3 images
- ✅ User can view feed with posts including inline image previews
- ✅ User can create a project and post to project feed
- ✅ User can download an encrypted file and open it successfully
- ✅ User can delete files and reclaim storage
- ✅ All operations work offline (no network required)

---

## Next Steps After Phase 1
→ **Phase 2:** Build calendar planner and enhanced task manager  
→ **Phase 3:** User profiles and social features  
→ **Phase 4:** Group encryption for shared projects
