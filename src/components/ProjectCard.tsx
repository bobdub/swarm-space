import { Users, Calendar, CheckCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Project } from "@/types";
import { Link } from "react-router-dom";

interface ProjectCardProps {
  project: Project;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const taskCount = Object.keys(project.tasks || {}).length;
  const completedTasks = Object.values(project.tasks || {}).filter(
    (t) => t.status === "done"
  ).length;
  const progress = taskCount > 0 ? (completedTasks / taskCount) * 100 : 0;
  
  return (
    <Link to={`/project/${project.id}`}>
      <Card className="p-6 shadow-card hover:shadow-glow transition-all cursor-pointer gradient-card border-primary/20">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold mb-2">{project.name}</h3>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {project.description}
            </p>
          </div>
        </div>
        
        <div className="space-y-3">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              <span>{project.members.length} members</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              <span>{completedTasks}/{taskCount} tasks</span>
            </div>
          </div>
          
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full gradient-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
