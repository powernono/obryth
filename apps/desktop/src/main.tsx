import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "dockview-react/dist/styles/dockview.css";
import "./styles.css";
import "./workspace.css";
import "./fonts.css";
import "./home.css";
import "./materials.css";
import "./terminal.css";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
