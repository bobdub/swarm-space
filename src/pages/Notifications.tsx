import { Navigation } from "@/components/Navigation";
import { Card } from "@/components/ui/card";
import { Bell } from "lucide-react";

const Notifications = () => {
  return (
    <div className="flex min-h-screen">
      <Navigation />
      
      <main className="flex-1 ml-64">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          <h1 className="text-3xl font-bold">Notifications</h1>
          
          <Card className="p-12 text-center">
            <Bell className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No notifications yet</p>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default Notifications;