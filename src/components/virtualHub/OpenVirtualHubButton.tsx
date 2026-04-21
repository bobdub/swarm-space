import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Boxes } from "lucide-react";
import { VirtualHubModal } from "./VirtualHubModal";

interface OpenVirtualHubButtonProps {
  projectId: string;
  projectName?: string;
  variant?: "default" | "outline" | "secondary";
  size?: "default" | "sm" | "lg";
}

export function OpenVirtualHubButton({
  projectId,
  variant = "outline",
  size = "sm",
}: OpenVirtualHubButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        className="gap-2"
      >
        <Boxes className="h-4 w-4" />
        Open Virtual Hub
      </Button>
      <VirtualHubModal open={open} onOpenChange={setOpen} projectId={projectId} />
    </>
  );
}