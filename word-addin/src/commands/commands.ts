/// <reference types="office-js" />

Office.onReady(() => {
  // no-op — ribbon commands are handled by the task pane
});

// Reserved for future ExecuteFunction ribbon actions.
// The current ribbon button uses ShowTaskpane (manifest) — no function call needed.
function openTaskpane(event: Office.AddinCommands.Event): void {
  event.completed();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).openTaskpane = openTaskpane;
