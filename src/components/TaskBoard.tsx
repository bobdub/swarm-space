import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Calendar } from "lucide-react";
import { Task } from "@/types";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import { format } from "date-fns";

interface TaskBoardProps {
  tasks: Task[];
  onTaskClick?: (task: Task) => void;
  onTaskMove?: (taskId: string, newStatus: Task["status"]) => void;
  onCreateClick?: (status: Task["status"]) => void;
}

interface TaskCardProps {
  task: Task;
  onClick?: () => void;
  isDragging?: boolean;
}

function TaskCard({ task, onClick, isDragging }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.5 : 1,
  };

  const priorityColors = {
    low: "border-blue-500/30",
    medium: "border-yellow-500/30",
    high: "border-orange-500/30",
    urgent: "border-red-500/30",
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card
        className={`p-4 cursor-pointer hover:shadow-glow transition-all border-l-4 ${
          priorityColors[task.priority || "medium"]
        }`}
        onClick={onClick}
      >
        <h4 className="font-medium mb-2">{task.title}</h4>
        {task.description && (
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
            {task.description}
          </p>
        )}
        <div className="flex items-center justify-between">
          {task.dueDate && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="w-3 h-3" />
              {format(new Date(task.dueDate), "MMM d")}
            </div>
          )}
          {task.assignees && task.assignees.length > 0 && (
            <div className="flex -space-x-2">
              {task.assignees.slice(0, 3).map((assignee, i) => (
                <div
                  key={i}
                  className="w-6 h-6 rounded-full bg-gradient-primary border-2 border-card flex items-center justify-center"
                >
                  <span className="text-xs">{assignee[0]?.toUpperCase()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

const columns = [
  { id: "backlog", label: "Backlog", color: "border-muted-foreground/20" },
  { id: "in-progress", label: "In Progress", color: "border-primary/50" },
  { id: "review", label: "Review", color: "border-accent/50" },
  { id: "done", label: "Done", color: "border-green-500/50" },
] as const;

export function TaskBoard({
  tasks,
  onTaskClick,
  onTaskMove,
  onCreateClick,
}: TaskBoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const getTasksByStatus = (status: Task["status"]) => {
    return tasks.filter((t) => t.status === status);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    if (task) {
      setActiveTask(task);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    const newStatus = over.id as Task["status"];
    
    const task = tasks.find((t) => t.id === taskId);
    if (task && task.status !== newStatus) {
      onTaskMove?.(taskId, newStatus);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-4 gap-4">
        {columns.map((column) => {
          const columnTasks = getTasksByStatus(column.id);

          return (
            <div key={column.id} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2">
                  {column.label}
                  <span className="text-sm text-muted-foreground">
                    {columnTasks.length}
                  </span>
                </h3>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => onCreateClick?.(column.id)}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              <SortableContext
                id={column.id}
                items={columnTasks.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2 min-h-[200px] p-2 rounded-lg border-2 border-dashed border-muted-foreground/20">
                  {columnTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onClick={() => onTaskClick?.(task)}
                    />
                  ))}
                </div>
              </SortableContext>
            </div>
          );
        })}
      </div>

      <DragOverlay>
        {activeTask && <TaskCard task={activeTask} isDragging />}
      </DragOverlay>
    </DndContext>
  );
}
