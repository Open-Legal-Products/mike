/// <reference types="office-js" />
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

Office.onReady(() => {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Root element #root not found in DOM");
  }
  const root = createRoot(container);
  root.render(
    // `@container` makes the whole pane a query container so descendants can
    // adapt spacing/type to the (resizable, usually narrow) task-pane width
    // via `@sm:`/`@md:` variants — viewport breakpoints never fire in a pane.
    <div className="@container h-full w-full bg-background text-foreground font-sans antialiased">
      <App />
    </div>
  );
});
