import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Milestone } from "@/types";
import { createMilestone, updateMilestone } from "@/lib/milestones";
import { toast } from "sonner";

const milestoneSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title too long"),
  description: z.string().max(1000, "Description too long").optional(),
  dueDate: z.date({ required_error: "Due date is required" }),
  color: z.string().optional(),
});

type MilestoneFormData = z.infer<typeof milestoneSchema>;

interface CreateMilestoneModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  initialData?: Partial<Milestone>;
  projectId?: string;
  selectedDate?: Date;
}

const colorOptions = [
  { value: "#3b82f6", label: "Blue" },
  { value: "#10b981", label: "Green" },
  { value: "#f59e0b", label: "Orange" },
  { value: "#ef4444", label: "Red" },
  { value: "#8b5cf6", label: "Purple" },
  { value: "#ec4899", label: "Pink" },
];

export function CreateMilestoneModal({
  open,
  onOpenChange,
  onSuccess,
  initialData,
  projectId,
  selectedDate,
}: CreateMilestoneModalProps) {
  const [loading, setLoading] = useState(false);
  
  const form = useForm<MilestoneFormData>({
    resolver: zodResolver(milestoneSchema),
    defaultValues: {
      title: initialData?.title || "",
      description: initialData?.description || "",
      dueDate: selectedDate || (initialData?.dueDate ? new Date(initialData.dueDate) : new Date()),
      color: initialData?.color || colorOptions[0].value,
    },
  });

  const onSubmit = async (data: MilestoneFormData) => {
    setLoading(true);
    try {
      if (initialData?.id) {
        await updateMilestone(initialData.id, {
          title: data.title,
          description: data.description,
          dueDate: data.dueDate.toISOString(),
          color: data.color,
        });
        toast.success("Milestone updated!");
      } else {
        await createMilestone({
          title: data.title,
          description: data.description || "",
          projectId,
          dueDate: data.dueDate.toISOString(),
          linkedTasks: [],
          completed: false,
          createdBy: "current-user", // TODO: Get from auth
          color: data.color,
        });
        toast.success("Milestone created!");
      }
      onSuccess();
      onOpenChange(false);
      form.reset();
    } catch (error) {
      toast.error("Failed to save milestone");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            {initialData?.id ? "Edit Milestone" : "Create Milestone"}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Milestone title" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Milestone description..."
                      className="min-h-[100px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="dueDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Due Date</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full pl-3 text-left font-normal",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          {field.value ? (
                            format(field.value, "PPP")
                          ) : (
                            <span>Pick a date</span>
                          )}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="color"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Color</FormLabel>
                  <FormControl>
                    <div className="flex gap-2">
                      {colorOptions.map((color) => (
                        <button
                          key={color.value}
                          type="button"
                          className={cn(
                            "w-8 h-8 rounded-full border-2 transition-all",
                            field.value === color.value
                              ? "border-foreground scale-110"
                              : "border-muted hover:scale-105"
                          )}
                          style={{ backgroundColor: color.value }}
                          onClick={() => field.onChange(color.value)}
                        />
                      ))}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Saving..." : initialData?.id ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
