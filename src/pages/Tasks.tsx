import { Navigation } from "@/components/Navigation";
import { TaskBoard } from "@/components/TaskBoard";
import { Task } from "@/types";
import { useState } from "react";

const Tasks = () => {
  const [tasks] = useState<Task[]>([
    {
      id: "1",
      title: "Implement WebRTC signaling",
      description: "Set up signaling server for P2P connections",
      status: "in-progress",
      assignees: ["user1"],
    },
    {
      id: "2",
      title: "Add file chunking UI",
      description: "Display upload progress for chunked files",
      status: "backlog",
    },
    {
      id: "3",
      title: "Design project hub",
      description: "Create mockups for project detail page",
      status: "review",
      assignees: ["user2"],
    },
    {
      id: "4",
      title: "Setup encryption tests",
      description: "Unit tests for crypto utilities",
      status: "done",
      assignees: ["user1"],
    },
  ]);
  
  return (
    <div className="flex min-h-screen">
      <Navigation />
      
      <main className="flex-1 ml-64">
        <div className="max-w-7xl mx-auto p-6 space-y-6">
          <h1 className="text-3xl font-bold">Tasks</h1>
          <TaskBoard tasks={tasks} />
        </div>
      </main>
    </div>
  );
};

export default Tasks;