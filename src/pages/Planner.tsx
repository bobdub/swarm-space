import { Navigation } from "@/components/Navigation";
import { Card } from "@/components/ui/card";
import { Calendar } from "lucide-react";

const Planner = () => {
  return (
    <div className="flex min-h-screen">
      <Navigation />
      
      <main className="flex-1 ml-64">
        <div className="max-w-7xl mx-auto p-6 space-y-6">
          <h1 className="text-3xl font-bold">Planner</h1>
          
          <Card className="p-12 text-center">
            <Calendar className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">Calendar and milestone view coming soon</p>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default Planner;