import { Navigation } from "@/components/Navigation";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

const Explore = () => {
  const categories = [
    { name: "Technology", count: 24, color: "from-blue-500 to-cyan-500" },
    { name: "Design", count: 18, color: "from-purple-500 to-pink-500" },
    { name: "Science", count: 15, color: "from-green-500 to-emerald-500" },
    { name: "Art", count: 32, color: "from-orange-500 to-red-500" },
    { name: "Music", count: 27, color: "from-indigo-500 to-purple-500" },
    { name: "Gaming", count: 41, color: "from-cyan-500 to-blue-500" },
  ];
  
  return (
    <div className="flex min-h-screen">
      <Navigation />
      
      <main className="flex-1 ml-64">
        <TopNavigationBar />
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          <h1 className="text-3xl font-bold">Explore</h1>
          
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Search projects, posts, and people..."
              className="pl-10"
            />
          </div>
          
          <div>
            <h2 className="text-xl font-semibold mb-4">Categories</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {categories.map((category) => (
                <Card
                  key={category.name}
                  className="p-6 cursor-pointer hover:shadow-glow transition-all"
                >
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${category.color} mb-4`} />
                  <h3 className="font-semibold text-lg mb-1">{category.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {category.count} projects
                  </p>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Explore;