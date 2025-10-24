import { TopNavigationBar } from "@/components/TopNavigationBar";
import { CreateMilestoneModal } from "@/components/CreateMilestoneModal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Milestone } from "@/types";
import { useEffect, useState } from "react";
import { getMilestones, deleteMilestone, completeMilestone } from "@/lib/milestones";
import { toast } from "sonner";
import { format, isSameDay } from "date-fns";
import { Check, Plus, Trash2 } from "lucide-react";

const Planner = () => {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedMilestone, setSelectedMilestone] = useState<Milestone | null>(null);

  useEffect(() => {
    loadMilestones();
  }, []);

  const loadMilestones = async () => {
    const loaded = await getMilestones();
    setMilestones(loaded);
  };

  const getMilestonesForDate = (date: Date) => {
    return milestones.filter((m) => isSameDay(new Date(m.dueDate), date));
  };

  const upcomingMilestones = milestones
    .filter((m) => new Date(m.dueDate) >= new Date() && !m.completed)
    .slice(0, 5);

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      setSelectedDate(date);
    }
  };

  const handleCreateMilestone = () => {
    setSelectedMilestone(null);
    setCreateModalOpen(true);
  };

  const handleEditMilestone = (milestone: Milestone) => {
    setSelectedMilestone(milestone);
    setCreateModalOpen(true);
  };

  const handleDeleteMilestone = async (id: string) => {
    try {
      await deleteMilestone(id);
      await loadMilestones();
      toast.success("Milestone deleted!");
    } catch (error) {
      toast.error("Failed to delete milestone");
      console.error(error);
    }
  };

  const handleCompleteMilestone = async (id: string) => {
    try {
      await completeMilestone(id);
      await loadMilestones();
      toast.success("Milestone completed!");
    } catch (error) {
      toast.error("Failed to complete milestone");
      console.error(error);
    }
  };

  return (
    <div className="min-h-screen">
      <TopNavigationBar />
      <main className="px-3 md:px-6 pb-6 space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold">Planner</h1>
            <Button onClick={handleCreateMilestone} className="gap-2">
              <Plus className="w-4 h-4" />
              New Milestone
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Calendar */}
            <Card className="p-6 lg:col-span-2">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={handleDateSelect}
                className="rounded-md border-0"
                modifiers={{
                  milestone: (date) => getMilestonesForDate(date).length > 0,
                }}
                modifiersStyles={{
                  milestone: {
                    fontWeight: "bold",
                    textDecoration: "underline",
                  },
                }}
              />

              {/* Milestones for selected date */}
              <div className="mt-6 space-y-3">
                <h3 className="font-semibold">
                  {format(selectedDate, "MMMM d, yyyy")}
                </h3>
                {getMilestonesForDate(selectedDate).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No milestones for this date
                  </p>
                ) : (
                  getMilestonesForDate(selectedDate).map((milestone) => (
                    <Card
                      key={milestone.id}
                      className="p-4 border-l-4 cursor-pointer hover:shadow-glow transition-shadow"
                      style={{ borderLeftColor: milestone.color }}
                      onClick={() => handleEditMilestone(milestone)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <h4 className="font-medium">{milestone.title}</h4>
                          {milestone.description && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {milestone.description}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-1">
                          {!milestone.completed && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCompleteMilestone(milestone.id);
                              }}
                            >
                              <Check className="w-4 h-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteMilestone(milestone.id);
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </Card>

            {/* Upcoming Milestones */}
            <Card className="p-6">
              <h3 className="font-semibold mb-4">Upcoming</h3>
              <div className="space-y-3">
                {upcomingMilestones.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No upcoming milestones
                  </p>
                ) : (
                  upcomingMilestones.map((milestone) => (
                    <div
                      key={milestone.id}
                      className="p-3 rounded-lg bg-secondary cursor-pointer hover:bg-secondary/80 transition-colors border-l-4"
                      style={{ borderLeftColor: milestone.color }}
                      onClick={() => handleEditMilestone(milestone)}
                    >
                      <h4 className="font-medium text-sm">{milestone.title}</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        {format(new Date(milestone.dueDate), "MMM d, yyyy")}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
      </main>

      <CreateMilestoneModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        onSuccess={loadMilestones}
        initialData={selectedMilestone || undefined}
        selectedDate={selectedDate}
      />
    </div>
  );
};

export default Planner;
