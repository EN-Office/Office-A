import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@/styles/tokens.css";
import "@/styles/global.css";
import "@/components/ui/ui.css";
import { applyTheme, initialTheme } from "@/lib/theme";
import App from "./App";

applyTheme(initialTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
