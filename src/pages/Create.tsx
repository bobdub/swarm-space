import { TopNavigationBar } from "@/components/TopNavigationBar";
import { PostComposer } from "@/components/PostComposer";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";

const Create = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultProject = searchParams.get("project") ?? searchParams.get("projectId") ?? undefined;

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!user) {
      const params = searchParams.toString();
      const redirect = params ? `/create?${params}` : "/create";
      navigate(`/auth?redirect=${encodeURIComponent(redirect)}`);
    }
  }, [user, navigate, searchParams]);

  const handleCancel = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  return (
    <div className="min-h-screen">
      <TopNavigationBar />

      <main className="mx-auto max-w-2xl space-y-6 px-3 pb-6 md:px-6">
        <PostComposer
          showHeader
          showPostHistory
          autoFocus
          defaultProjectId={defaultProject}
          onCancel={handleCancel}
          onSetupDismiss={handleCancel}
        />
      </main>
    </div>
  );
};

export default Create;
