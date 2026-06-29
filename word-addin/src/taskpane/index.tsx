/// <reference types="office-js" />
import React from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import App from "./App";

Office.onReady(() => {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Root element #root not found in DOM");
  }
  const root = createRoot(container);
  root.render(
    <FluentProvider theme={webLightTheme}>
      <App />
    </FluentProvider>
  );
});
