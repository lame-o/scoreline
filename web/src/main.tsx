import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function Probe() {
  return <p>Scoreline</p>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Probe />
  </StrictMode>,
);
