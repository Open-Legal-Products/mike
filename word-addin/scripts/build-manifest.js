const fs = require("fs");
const path = require("path");

const publicUrl = (process.env.WORD_ADDIN_PUBLIC_URL || "").replace(/\/$/, "");
if (!/^https:\/\/[^/]+(?:\/.*)?$/.test(publicUrl)) {
  throw new Error(
    "WORD_ADDIN_PUBLIC_URL must be the deployed HTTPS origin for the Word add-in"
  );
}

const sourcePath = path.resolve(__dirname, "../manifest.xml");
const outputPath = path.resolve(__dirname, "../dist/manifest.xml");
const manifest = fs
  .readFileSync(sourcePath, "utf8")
  .replaceAll("https://localhost:3000", publicUrl);

if (manifest.includes("https://localhost:3000")) {
  throw new Error("Production manifest still contains localhost URLs");
}

fs.writeFileSync(outputPath, manifest);
console.log(`Wrote production manifest for ${publicUrl}`);
