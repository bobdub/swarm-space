// Milestone CRUD operations and management
import { Milestone } from "@/types";
import { put, get, getAll, remove } from "./store";

export async function createMilestone(
  milestone: Omit<Milestone, "id" | "createdAt" | "updatedAt">
): Promise<Milestone> {
  const newMilestone: Milestone = {
    ...milestone,
    id: `milestone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  await put("milestones", newMilestone);
  return newMilestone;
}

export async function updateMilestone(
  id: string,
  updates: Partial<Omit<Milestone, "id" | "createdAt">>
): Promise<void> {
  const milestone = await get<Milestone>("milestones", id);
  if (!milestone) throw new Error("Milestone not found");
  
  const updatedMilestone: Milestone = {
    ...milestone,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  await put("milestones", updatedMilestone);
}

export async function deleteMilestone(id: string): Promise<void> {
  await remove("milestones", id);
}

export async function getMilestones(projectId?: string): Promise<Milestone[]> {
  let milestones = await getAll<Milestone>("milestones");
  
  if (projectId) {
    milestones = milestones.filter((m) => m.projectId === projectId);
  }
  
  return milestones.sort(
    (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
  );
}

export async function getMilestonesByDateRange(
  start: Date,
  end: Date
): Promise<Milestone[]> {
  const milestones = await getAll<Milestone>("milestones");
  
  return milestones.filter((m) => {
    const dueDate = new Date(m.dueDate);
    return dueDate >= start && dueDate <= end;
  });
}

export async function linkTaskToMilestone(
  taskId: string,
  milestoneId: string
): Promise<void> {
  const milestone = await get<Milestone>("milestones", milestoneId);
  if (!milestone) throw new Error("Milestone not found");
  
  const linkedTasks = milestone.linkedTasks || [];
  if (!linkedTasks.includes(taskId)) {
    await updateMilestone(milestoneId, {
      linkedTasks: [...linkedTasks, taskId],
    });
  }
}

export async function unlinkTaskFromMilestone(
  taskId: string,
  milestoneId: string
): Promise<void> {
  const milestone = await get<Milestone>("milestones", milestoneId);
  if (!milestone) throw new Error("Milestone not found");
  
  await updateMilestone(milestoneId, {
    linkedTasks: (milestone.linkedTasks || []).filter((id) => id !== taskId),
  });
}

export async function completeMilestone(id: string): Promise<void> {
  await updateMilestone(id, {
    completed: true,
    completedAt: new Date().toISOString(),
  });
}

export async function incompleteMilestone(id: string): Promise<void> {
  const milestone = await get<Milestone>("milestones", id);
  if (!milestone) throw new Error("Milestone not found");
  
  const updates: Partial<Milestone> = {
    completed: false,
    completedAt: undefined,
  };
  
  await updateMilestone(id, updates);
}
