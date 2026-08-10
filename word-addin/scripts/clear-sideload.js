/**
 * Best-effort `office-addin-debugging stop` before every `npm start` or
 * `bun dev` (wired as the "prestart" and "predev" hooks).
 *
 * Why: office-addin-debugging registers the add-in by hard-linking
 * manifest.xml into Word's sideload folder. If a previous run exited
 * without `npm run stop` (crash, Ctrl-C, killed terminal), the link is
 * left behind and the next launch dies with an opaque
 * "EEXIST: file already exists, link 'manifest.xml' -> …/wef/….manifest.xml".
 * Stopping first makes both launch commands idempotent.
 *
 * Failures are swallowed on purpose: on a clean machine there is nothing
 * to stop, and a broken stop must never block start (start will surface
 * its own, more actionable, error).
 */
const { spawnSync } = require("child_process");

spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["--no-install", "office-addin-debugging", "stop", "manifest.xml"],
  { stdio: "ignore", cwd: __dirname + "/.." }
);
process.exit(0);
