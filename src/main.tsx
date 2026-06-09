import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { CategoriesProvider } from "@/lib/categoriesContext";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <CategoriesProvider>
      <App />
    </CategoriesProvider>
  </React.StrictMode>,
);
