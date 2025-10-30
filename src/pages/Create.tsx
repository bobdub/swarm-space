import { TopNavigationBar } from "@/components/TopNavigationBar";
import { PostComposer } from "@/components/PostComposer";
import { useNavigate, useSearchParams } from "react-router-dom";

const Create = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultProject = searchParams.get("project") ?? searchParams.get("projectId") ?? undefined;

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
