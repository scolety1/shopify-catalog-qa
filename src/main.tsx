import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CatalogQaApp } from "./ui/CatalogQaApp";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Catalog QA root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <CatalogQaApp />
  </StrictMode>,
);