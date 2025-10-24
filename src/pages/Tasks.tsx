import { TopNavigationBar } from "@/components/TopNavigationBar";
import { TaskBoard } from "@/components/TaskBoard";
import { CreateTaskModal } from "@/components/CreateTaskModal";
import { Task } from "@/types";
import { useEffect, useState } from "react";
import { getTasks, updateTask } from "@/lib/tasks";
import { toast } from "sonner";

const Tasks = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [initialStatus, setInitialStatus] = useState<Task["status"]>("backlog");

  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    const loadedTasks = await getTasks();
    setTasks(loadedTasks);
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    setCreateModalOpen(true);
  };

  const handleTaskMove = async (taskId: string, newStatus: Task["status"]) => {
    try {
      await updateTask(taskId, { status: newStatus });
      await loadTasks();
      toast.success("Task moved!");
    } catch (error) {
      toast.error("Failed to move task");
      console.error(error);
    }
  };

  const handleCreateClick = (status: Task["status"]) => {
    setSelectedTask(null);
    setInitialStatus(status);
    setCreateModalOpen(true);
  };

  const handleModalClose = () => {
    setCreateModalOpen(false);
    setSelectedTask(null);
  };

  return (
    <div className="min-h-screen">
      <TopNavigationBar />
      <main className="px-3 md:px-6 pb-6 space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold">Tasks</h1>
          </div>
          
          <TaskBoard
            tasks={tasks}
            onTaskClick={handleTaskClick}
            onTaskMove={handleTaskMove}
            onCreateClick={handleCreateClick}
          />
      </main>

      <CreateTaskModal
        open={createModalOpen}
        onOpenChange={handleModalClose}
        onSuccess={loadTasks}
        initialData={selectedTask ? { ...selectedTask, status: selectedTask.status } : { status: initialStatus }}
      />
    </div>
  );
};

export default Tasks;
