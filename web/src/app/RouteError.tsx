/**
 * A page that threw: the app's error state instead of a blank screen, with
 * a way back. (Route-level, so the sidebar and other pages keep working.)
 */
import { useNavigate, useRouteError } from "react-router";
import { Button, EmptyState } from "../design/components";

export function RouteError() {
  const error = useRouteError();
  const navigate = useNavigate();
  if (import.meta.env.DEV) console.error(error);
  return (
    <div role="alert">
      <EmptyState
        icon="wifiSlash"
        title="Something Went Wrong"
        message="This page hit a problem. Try again, or go back to the scores."
        actions={
          <>
            <Button onClick={() => window.location.reload()}>Try Again</Button>
            <Button onClick={() => navigate("/")}>Back to Scores</Button>
          </>
        }
      />
    </div>
  );
}
