# Phase 2: Planner & Task System Implementation Plan
**Status:** 🚀 READY TO START  
**Duration:** 3-4 days  
**Prerequisites:** Phase 1 Sprint 1 complete ✅

---

## Overview

Phase 2 transforms the placeholder planner and task manager into fully functional, offline-first project management tools. This phase includes:

1. **Enhanced Task Manager** with full CRUD operations
2. **Calendar/Planner** with milestone management
3. **Drag-and-drop** interactions for intuitive UX
4. **Offline-first persistence** with change tracking
5. **Foundation for future sync** (P2P preparation)

---

## Sprint Breakdown

### Sprint 1: Core Task System (Days 1-2)

#### Goals
- Task CRUD operations
- IndexedDB persistence
- Drag-and-drop kanban
- Task filtering and search

#### Implementation Tasks

##### 1.1: Task Data Layer (`src/lib/tasks.ts`)
```typescript
// New file: src/lib/tasks.ts
export async function createTask(task: Omit<Task, 'id' | 'createdAt'>): Promise<Task>
export async function updateTask(id: string, updates: Partial<Task>): Promise<void>
export async function deleteTask(id: string): Promise<void>
export async function getTasks(filters?: TaskFilters): Promise<Task[]>
export async function getTasksByProject(projectId: string): Promise<Task[]>
export async function assignTask(taskId: string, userId: string): Promise<void>
```

##### 1.2: Task Creation Modal (`src/components/CreateTaskModal.tsx`)
- Form fields: title, description, status, priority, assignees, dueDate, projectId
- Validation with zod
- Integration with shadcn/ui Dialog + Form
- Save to IndexedDB on submit

##### 1.3: Enhanced TaskBoard (`src/components/TaskBoard.tsx`)
**Current State:** Presentational component with mock data  
**Target State:** Fully interactive kanban with persistence

**Changes:**
- Load tasks from IndexedDB
- Implement drag-and-drop (using `@dnd-kit/core`)
- Update task status on column change
- Add task cards with click-to-edit
- Quick-add task input per column
- Filter toolbar (by assignee, due date, priority)

##### 1.4: Task Detail View (`src/components/TaskDetail.tsx`)
- Full task information display
- Edit inline or modal
- Comment thread (prepare for future)
- Activity log (local changes)
- Delete confirmation

##### 1.5: Tasks Page Enhancement (`src/pages/Tasks.tsx`)
- Connect to real data
- Add filters: All, My Tasks, Overdue, By Project
- Search across task titles/descriptions
- Bulk actions (later)

---

### Sprint 2: Planner & Calendar (Days 2-3)

#### Goals
- Calendar component (month/week views)
- Milestone CRUD operations
- Visual milestone scheduling
- Link milestones to tasks

#### Implementation Tasks

##### 2.1: Calendar Component (`src/components/Calendar.tsx`)
**Library Decision:** Use `react-big-calendar` for quick implementation

**Features:**
- Month view (default)
- Week view toggle
- Milestone events rendered
- Click date → create milestone
- Click milestone → edit modal

**Installation:**
```bash
npm install react-big-calendar date-fns
npm install --save-dev @types/react-big-calendar
```

##### 2.2: Milestone Data Layer (`src/lib/milestones.ts`)
```typescript
export async function createMilestone(milestone: Omit<Milestone, 'id'>): Promise<Milestone>
export async function updateMilestone(id: string, updates: Partial<Milestone>): Promise<void>
export async function deleteMilestone(id: string): Promise<void>
export async function getMilestones(projectId?: string): Promise<Milestone[]>
export async function getMilestonesByDateRange(start: Date, end: Date): Promise<Milestone[]>
export async function linkTaskToMilestone(taskId: string, milestoneId: string): Promise<void>
```

##### 2.3: Milestone Modal (`src/components/CreateMilestoneModal.tsx`)
- Fields: title, description, dueDate, projectId, linkedTasks[]
- Date picker with shadcn/ui Calendar
- Task selector (multi-select from project tasks)
- Color picker for milestone (visual distinction)

##### 2.4: Planner Page Enhancement (`src/pages/Planner.tsx`)
**Current State:** Placeholder  
**Target State:** Full calendar with milestones

```tsx
// Structure:
<div className="planner-layout">
  <CalendarToolbar /> {/* View toggle, filters, create button */}
  <Calendar 
    events={milestones}
    onSelectEvent={openMilestoneDetail}
    onSelectSlot={createMilestone}
  />
  <UpcomingMilestones /> {/* Sidebar with next 5 milestones */}
</div>
```

##### 2.5: Milestone-Task Linking UI
- In task detail: show linked milestone
- In milestone detail: show linked tasks list
- Drag task onto milestone in calendar (future enhancement)

---

### Sprint 3: Offline Sync Foundation (Day 3-4)

#### Goals
- Change event queue for offline edits
- Conflict detection system
- Sync status indicators
- Foundation for future P2P sync

#### Implementation Tasks

##### 3.1: Change Queue System (`src/lib/syncQueue.ts`)
```typescript
export interface ChangeEvent {
  id: string;
  type: 'create' | 'update' | 'delete';
  entity: 'task' | 'milestone' | 'post' | 'project';
  entityId: string;
  userId: string;
  timestamp: number;
  data: any;
  synced: boolean;
}

export async function queueChange(event: Omit<ChangeEvent, 'id' | 'synced'>): Promise<void>
export async function getPendingChanges(): Promise<ChangeEvent[]>
export async function markSynced(eventId: string): Promise<void>
export async function clearSyncedChanges(): Promise<void>
```

##### 3.2: Vector Clocks (`src/lib/vectorClock.ts`)
For conflict detection in future P2P sync

```typescript
export interface VectorClock {
  [userId: string]: number;
}

export function incrementClock(clock: VectorClock, userId: string): VectorClock
export function merge(clock1: VectorClock, clock2: VectorClock): VectorClock
export function compare(clock1: VectorClock, clock2: VectorClock): 'before' | 'after' | 'concurrent'
```

##### 3.3: Sync Status UI Components
- `<SyncIndicator />` in navigation (shows pending changes count)
- Offline/online status dot
- Manual sync trigger button (for future)
- Last synced timestamp display

##### 3.4: Optimistic Updates
- Update UI immediately on changes
- Queue change for sync
- Rollback on conflict (future)

---

## Dependencies to Install

```bash
# Drag-and-drop
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities

# Calendar
npm install react-big-calendar date-fns

# Types
npm install --save-dev @types/react-big-calendar
```

---

## File Structure Changes

```
src/
├── lib/
│   ├── tasks.ts              # NEW: Task CRUD operations
│   ├── milestones.ts         # NEW: Milestone CRUD operations
│   ├── syncQueue.ts          # NEW: Offline sync queue
│   └── vectorClock.ts        # NEW: Conflict detection
├── components/
│   ├── Calendar.tsx          # NEW: Calendar component
│   ├── CreateTaskModal.tsx   # NEW: Task creation modal
│   ├── CreateMilestoneModal.tsx  # NEW: Milestone modal
│   ├── TaskDetail.tsx        # NEW: Task detail view
│   ├── SyncIndicator.tsx     # NEW: Sync status display
│   └── TaskBoard.tsx         # ENHANCED: Add drag-and-drop + persistence
├── pages/
│   ├── Tasks.tsx             # ENHANCED: Connect to real data
│   └── Planner.tsx           # ENHANCED: Add calendar + milestones
└── hooks/
    └── useTasks.ts           # NEW: React Query hooks for tasks
```

---

## Data Model Updates

### Task Model Enhancement
```typescript
export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'backlog' | 'todo' | 'in-progress' | 'review' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  projectId?: string;
  assignees: string[]; // userIds
  dueDate?: string; // ISO date
  milestoneId?: string; // NEW: Link to milestone
  tags: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string; // userId
  estimatedHours?: number; // NEW: Time estimate
  actualHours?: number; // NEW: Time tracking
  comments: Comment[]; // NEW: Thread support
  attachments: string[]; // NEW: manifestIds
  vectorClock?: VectorClock; // NEW: For sync
}
```

### Milestone Model Enhancement
```typescript
export interface Milestone {
  id: string;
  title: string;
  description?: string;
  dueDate: string; // ISO date
  projectId?: string;
  linkedTasks: string[]; // taskIds
  color?: string; // Hex color for calendar
  completed: boolean;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string; // userId
  vectorClock?: VectorClock; // NEW: For sync
}
```

### IndexedDB Schema Update
```typescript
// Add to src/lib/store.ts
if (!db.objectStoreNames.contains("tasks")) {
  const taskStore = db.createObjectStore("tasks", { keyPath: "id" });
  taskStore.createIndex("projectId", "projectId", { unique: false });
  taskStore.createIndex("status", "status", { unique: false });
  taskStore.createIndex("assignees", "assignees", { multiEntry: true });
}

if (!db.objectStoreNames.contains("milestones")) {
  const milestoneStore = db.createObjectStore("milestones", { keyPath: "id" });
  milestoneStore.createIndex("projectId", "projectId", { unique: false });
  milestoneStore.createIndex("dueDate", "dueDate", { unique: false });
}

if (!db.objectStoreNames.contains("syncQueue")) {
  db.createObjectStore("syncQueue", { keyPath: "id" });
}
```

---

## UI/UX Considerations

### Task Board Interactions
1. **Drag-and-drop:**
   - Smooth animations with @dnd-kit
   - Visual feedback (card elevation, column highlight)
   - Snap-back on invalid drop

2. **Quick Actions:**
   - Click card → open detail modal
   - Right-click → context menu (edit, delete, assign)
   - Keyboard shortcuts (n = new task, / = search)

3. **Filtering:**
   - Persistent filter state in localStorage
   - Visual indicators for active filters
   - Clear all filters button

### Calendar/Planner UX
1. **Date Selection:**
   - Click empty date → create milestone
   - Drag milestone → reschedule (future)
   - Today button to jump to current date

2. **View Switching:**
   - Toggle between month/week/day views
   - Persist view preference
   - Responsive: mobile defaults to day view

3. **Visual Design:**
   - Color-coded milestones by project
   - Progress indicators on milestone events
   - Subtle animations for date changes

---

## Testing Strategy

### Unit Tests (Vitest)
```typescript
// tests/lib/tasks.test.ts
describe('Task CRUD operations', () => {
  test('creates task with generated ID', async () => { ... })
  test('updates task status', async () => { ... })
  test('deletes task and removes from IndexedDB', async () => { ... })
  test('filters tasks by status', async () => { ... })
})

// tests/lib/syncQueue.test.ts
describe('Sync queue', () => {
  test('queues change event', async () => { ... })
  test('retrieves pending changes', async () => { ... })
  test('marks change as synced', async () => { ... })
})
```

### Integration Tests
```typescript
// tests/integration/taskBoard.test.tsx
describe('TaskBoard interactions', () => {
  test('creates new task via quick-add', async () => { ... })
  test('drags task to different column', async () => { ... })
  test('persists changes to IndexedDB', async () => { ... })
})
```

### Manual Testing Checklist
- [ ] Create task → appears in board
- [ ] Drag task → status updates
- [ ] Edit task → changes persist after refresh
- [ ] Delete task → removed from board and IndexedDB
- [ ] Create milestone → shows in calendar
- [ ] Link task to milestone → appears in milestone detail
- [ ] Offline mode → changes queue correctly
- [ ] Multiple devices (future) → sync queue works

---

## Success Criteria

### Functional Requirements
- [x] Users can create/edit/delete tasks
- [x] Tasks persist in IndexedDB
- [x] Drag-and-drop updates task status
- [x] Users can create/edit/delete milestones
- [x] Calendar displays milestones visually
- [x] Tasks can be linked to milestones
- [x] Offline changes are queued for future sync

### Performance Requirements
- Task board renders < 100ms for 50 tasks
- Drag operation feels smooth (60fps)
- IndexedDB operations complete < 50ms
- No UI blocking during large data loads

### UX Requirements
- Intuitive drag-and-drop (no learning curve)
- Keyboard navigation works for all actions
- Loading states visible for async operations
- Error messages are clear and actionable

---

## Future Enhancements (Phase 3+)

1. **Task Dependencies:**
   - Block tasks until dependencies complete
   - Visual dependency graph

2. **Time Tracking:**
   - Start/stop timer per task
   - Time entries log
   - Burndown charts

3. **Recurring Tasks:**
   - Daily/weekly/monthly patterns
   - Auto-create on schedule

4. **Subtasks:**
   - Nested task hierarchies
   - Progress rollup to parent

5. **Task Templates:**
   - Save task sets as templates
   - One-click project initialization

6. **Advanced Filters:**
   - Custom filter builder
   - Saved filter presets
   - Smart filters (overdue, unassigned, etc.)

7. **Kanban Customization:**
   - Custom column names
   - WIP limits per column
   - Swimlanes (by assignee, priority)

---

## Risk Mitigation

### Risk: Drag-and-drop library learning curve
**Mitigation:** Use @dnd-kit (well-documented), follow official examples

### Risk: Calendar component too heavy
**Mitigation:** Code-split calendar page, lazy load component

### Risk: IndexedDB quota exceeded
**Mitigation:** Add quota monitoring, warn user at 80%, allow export/cleanup

### Risk: Sync conflicts in future P2P
**Mitigation:** Vector clocks + CRDT research now, implement in Phase 5

### Risk: Performance with many tasks
**Mitigation:** Virtual scrolling, pagination, lazy loading

---

## Next Steps

1. ✅ Install dependencies (@dnd-kit, react-big-calendar)
2. ✅ Implement task CRUD layer (src/lib/tasks.ts)
3. ✅ Enhance TaskBoard with drag-and-drop
4. ✅ Build Calendar component
5. ✅ Implement milestone system
6. ✅ Add sync queue foundation
7. 🔄 Testing + bug fixes
8. 🔄 Documentation updates

---

**Ready to proceed? Let's build the task and planner systems!** 🚀
