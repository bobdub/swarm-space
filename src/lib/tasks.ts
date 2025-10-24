// Task CRUD operations and management
import { Task } from "@/types";
import { put, get, getAll, remove, openDB } from "./store";

export async function createTask(
  task: Omit<Task, "id" | "createdAt" | "updatedAt">
): Promise<Task> {
  const newTask: Task = {
    ...task,
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  await put("tasks", newTask);
  return newTask;
}

export async function updateTask(
  id: string,
  updates: Partial<Omit<Task, "id" | "createdAt">>
): Promise<void> {
  const task = await get<Task>("tasks", id);
  if (!task) throw new Error("Task not found");
  
  const updatedTask: Task = {
    ...task,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  await put("tasks", updatedTask);
}

export async function deleteTask(id: string): Promise<void> {
  await remove("tasks", id);
}

export interface TaskFilters {
  status?: Task["status"];
  priority?: Task["priority"];
  projectId?: string;
  assignee?: string;
  search?: string;
}

export async function getTasks(filters?: TaskFilters): Promise<Task[]> {
  let tasks = await getAll<Task>("tasks");
  
  if (!filters) return tasks;
  
  if (filters.status) {
    tasks = tasks.filter((t) => t.status === filters.status);
  }
  
  if (filters.priority) {
    tasks = tasks.filter((t) => t.priority === filters.priority);
  }
  
  if (filters.projectId) {
    tasks = tasks.filter((t) => t.projectId === filters.projectId);
  }
  
  if (filters.assignee) {
    tasks = tasks.filter((t) => t.assignees?.includes(filters.assignee));
  }
  
  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    tasks = tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(searchLower) ||
        t.description?.toLowerCase().includes(searchLower)
    );
  }
  
  return tasks;
}

export async function getTasksByProject(projectId: string): Promise<Task[]> {
  return getTasks({ projectId });
}

export async function assignTask(taskId: string, userId: string): Promise<void> {
  const task = await get<Task>("tasks", taskId);
  if (!task) throw new Error("Task not found");
  
  const assignees = task.assignees || [];
  if (!assignees.includes(userId)) {
    await updateTask(taskId, {
      assignees: [...assignees, userId],
    });
  }
}

export async function unassignTask(taskId: string, userId: string): Promise<void> {
  const task = await get<Task>("tasks", taskId);
  if (!task) throw new Error("Task not found");
  
  await updateTask(taskId, {
    assignees: (task.assignees || []).filter((id) => id !== userId),
  });
}
