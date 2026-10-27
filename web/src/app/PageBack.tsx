/**
 * The page header's Back button, the same on every page: it names the page
 * it returns to ("‹ Schedule", "‹ Chiefs"; RootView's `backTitle`) and, beside
 * the sidebar, shows only when it leads somewhere the sidebar isn't
 * (navigation.ts `useBack`). Esc does the same from anywhere.
 */
import { BackButton } from "../design/components";
import { useBack, useGoBack } from "./navigation";

export function PageBack() {
  const back = useBack();
  const goBack = useGoBack();
  return back.visible ? <BackButton to={back.title} onClick={() => goBack()} /> : null;
}
