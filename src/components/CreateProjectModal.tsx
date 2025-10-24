import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Plus, Loader2 } from "lucide-react";
import { createProject } from "@/lib/projects";
import { toast } from "@/hooks/use-toast";

interface CreateProjectModalProps {
  onProjectCreated?: () => void;
}

export function CreateProjectModal({ onProjectCreated }: CreateProjectModalProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [allowJoinRequests, setAllowJoinRequests] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast({
        title: "Name required",
        description: "Please enter a project name",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await createProject(name, description, {
        visibility: isPublic ? "public" : "private",
        allowJoinRequests,
      });

      toast({
        title: "Project created",
        description: `"${name}" has been created successfully`,
      });

      setOpen(false);
      setName("");
      setDescription("");
      setIsPublic(true);
      setAllowJoinRequests(true);

      if (onProjectCreated) {
        onProjectCreated();
      }
    } catch (error) {
      console.error("Failed to create project:", error);
      toast({
        title: "Failed to create project",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          New Project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,8%,0.95)] backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-display uppercase tracking-wider text-foreground">
            Create New Project
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 pt-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-sm font-semibold uppercase tracking-wider text-foreground/90">
              Project Name *
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome Project"
              className="border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,10%,0.6)] text-foreground"
              required
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="text-sm font-semibold uppercase tracking-wider text-foreground/90">
              Description
            </Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell people what this project is about..."
              className="min-h-[100px] border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,10%,0.6)] text-foreground resize-none"
              maxLength={500}
            />
            <p className="text-xs text-foreground/50">
              {description.length}/500 characters
            </p>
          </div>

          <div className="space-y-4 rounded-xl border border-[hsla(174,59%,56%,0.15)] bg-[hsla(245,70%,12%,0.4)] p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="visibility" className="text-sm font-medium text-foreground">
                  Public Project
                </Label>
                <p className="text-xs text-foreground/60">
                  Anyone can discover and view this project
                </p>
              </div>
              <Switch
                id="visibility"
                checked={isPublic}
                onCheckedChange={setIsPublic}
              />
            </div>

            {isPublic && (
              <div className="flex items-center justify-between pt-2 border-t border-[hsla(174,59%,56%,0.1)]">
                <div className="space-y-0.5">
                  <Label htmlFor="joinRequests" className="text-sm font-medium text-foreground">
                    Allow Join Requests
                  </Label>
                  <p className="text-xs text-foreground/60">
                    Users can request to join this project
                  </p>
                </div>
                <Switch
                  id="joinRequests"
                  checked={allowJoinRequests}
                  onCheckedChange={setAllowJoinRequests}
                />
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              className="flex-1"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="flex-1 gap-2 bg-gradient-to-r from-[hsl(326,71%,62%)] to-[hsl(174,59%,56%)] hover:opacity-90"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Create Project
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
