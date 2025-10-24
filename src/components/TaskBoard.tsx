import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Task } from "@/types";

interface TaskBoardProps {
  tasks: Task[];
  onTaskClick?: (task: Task) => void;
}

const columns = [
  { id: "backlog", label: "Backlog", color: "border-muted-foreground/20" },
  { id: "in-progress", label: "In Progress", color: "border-primary/50" },
  { id: "review", label: "Review", color: "border-accent/50" },
  { id: "done", label: "Done", color: "border-green-500/50" },
] as const;

export function TaskBoard({ tasks, onTaskClick }: TaskBoardProps) {
  const getTasksByStatus = (status: Task["status"]) => {
    return tasks.filter((t) => t.status === status);
  };
  
  return (
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
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            
            <div className="space-y-2">
              {columnTasks.map((task) => (
                <Card
                  key={task.id}
                  className={`p-4 cursor-pointer hover:shadow-glow transition-shadow border-l-4 ${column.color}`}
                  onClick={() => onTaskClick?.(task)}
                >
                  <h4 className="font-medium mb-2">{task.title}</h4>
                  {task.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                      {task.description}
                    </p>
                  )}
                  {task.assignees && task.assignees.length > 0 && (
                    <div className="flex -space-x-2">
                      {task.assignees.slice(0, 3).map((assignee, i) => (
                        <div
                          key={i}
                          className="w-6 h-6 rounded-full bg-gradient-primary border-2 border-card flex items-center justify-center"
                        >
                          <span className="text-xs">
                            {assignee[0]?.toUpperCase()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
