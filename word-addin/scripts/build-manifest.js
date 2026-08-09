const fs = require("fs");
const path = require("path");

const publicUrlInput = (process.env.WORD_ADDIN_PUBLIC_URL || "").trim();
let parsedPublicUrl;
try {
  parsedPublicUrl = new URL(publicUrlInput);
} catch {
  throw new Error(
    "WORD_ADDIN_PUBLIC_URL must be the deployed HTTPS origin for the Word add-in"
  );
}
if (
  parsedPublicUrl.protocol !== "https:" ||
  parsedPublicUrl.username ||
  parsedPublicUrl.password ||
  parsedPublicUrl.search ||
  parsedPublicUrl.hash ||
  parsedPublicUrl.pathname !== "/"
) {
  throw new Error(
    "WORD_ADDIN_PUBLIC_URL must be an HTTPS origin without credentials, a path, query, or fragment"
  );
}
const publicUrl = parsedPublicUrl.origin;

const sourcePath = path.resolve(__dirname, "../manifest.xml");
const distPath = path.resolve(__dirname, "../dist");
const outputPath = path.join(distPath, "manifest.xml");
const manifest = fs
  .readFileSync(sourcePath, "utf8")
  .replaceAll("https://localhost:3000", publicUrl);

if (manifest.includes("https://localhost:3000")) {
  throw new Error("Production manifest still contains localhost URLs");
}

fs.writeFileSync(outputPath, manifest);

const assetOutputPath = path.join(distPath, "assets");
fs.mkdirSync(assetOutputPath, { recursive: true });
for (const filename of ["icon-16.png", "icon-32.png", "icon-80.png"]) {
  fs.copyFileSync(
    path.resolve(__dirname, "../assets", filename),
    path.join(assetOutputPath, filename)
  );
}

console.log(`Wrote production manifest and ribbon icons for ${publicUrl}`);
