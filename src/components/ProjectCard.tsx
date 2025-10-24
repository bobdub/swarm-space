import { Users, CheckCircle } from "lucide-react";
import { Link } from "react-router-dom";

import { Card } from "@/components/ui/card";
import { Project } from "@/types";

interface ProjectCardProps {
  project: Project;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const taskCount = Object.keys(project.tasks || {}).length;
  const completedTasks = Object.values(project.tasks || {}).filter((t) => t.status === "done").length;
  const progress = taskCount > 0 ? (completedTasks / taskCount) * 100 : 0;

  return (
    <Link to={`/project/${project.id}`} className="group relative block">
      <div className="absolute inset-0 rounded-[24px] bg-gradient-to-br from-[hsla(326,71%,62%,0.25)] via-transparent to-[hsla(174,59%,56%,0.25)] opacity-60 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="absolute inset-0 rounded-[24px] bg-[hsla(326,71%,62%,0.16)] opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-60" />
      <Card className="relative h-full rounded-[24px] border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.82)] p-6 text-foreground shadow-[0_24px_80px_hsla(244,70%,5%,0.6)] backdrop-blur-2xl transition-transform duration-300 group-hover:-translate-y-1">
        <div className="space-y-6">
          <div className="space-y-2">
            <span className="inline-flex items-center rounded-full border border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,12%,0.55)] px-3 py-1 text-[0.65rem] font-display uppercase tracking-[0.35em] text-foreground/65">
              Active Thread
            </span>
            <h3 className="text-2xl font-semibold tracking-[0.08em] text-foreground">
              {project.name}
            </h3>
            <p className="text-sm leading-relaxed text-foreground/70 line-clamp-3">
              {project.description}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm text-foreground/70">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-[hsl(174,59%,56%)]" />
              <span>{project.members.length} members</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-[hsl(174,59%,56%)]" />
              <span>
                {completedTasks}/{taskCount} tasks
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[0.7rem] font-display uppercase tracking-[0.3em] text-foreground/55">
              <span>Progress</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-2 rounded-full bg-[hsla(245,70%,16%,0.55)]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[hsla(326,71%,62%,0.6)] via-[hsla(326,71%,62%,0.45)] to-[hsla(174,59%,56%,0.55)] transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
