import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import { App } from "./App.jsx";
import "./styles.css";

try {
  const preference = localStorage.getItem("file-mask-theme") || "system";
  const resolved = preference === "system"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.style.colorScheme = resolved;
} catch {
  document.documentElement.dataset.theme = "light";
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
