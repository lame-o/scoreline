import { useNavigate } from "react-router";
import { Button, EmptyState } from "../design/components";

export function NotFound() {
  const navigate = useNavigate();
  return (
    <EmptyState
      icon="sportscourt"
      title="Page Not Found"
      message="This address doesn't lead anywhere in Scoreline."
      actions={<Button onClick={() => navigate("/")}>Back to Scores</Button>}
    />
  );
}
