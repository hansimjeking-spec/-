import { copyFile, mkdir } from "node:fs/promises";

await mkdir("public", { recursive: true });
await mkdir("public/vendor", { recursive: true });

for (const file of [
  "index.html",
  "styles.css",
  "app.js",
  "radar-enhancements.css",
  "radar-enhancements.js",
  "radar-lounge.css",
  "radar-lounge.js",
  "radar-ops.css",
  "radar-ops.js",
  "radar-governance.css",
  "radar-governance.js",
  "radar-supabase.css",
  "radar-supabase.js"
]) {
  await copyFile(file, `public/${file}`);
}

await copyFile("supabase-schema.sql", "public/supabase-schema.sql");
await copyFile(
  "node_modules/@ssabrojs/hwpxjs/dist/browser/hwpxjs.browser.mjs",
  "public/vendor/hwpxjs.browser.mjs"
);
await copyFile("node_modules/pdfjs-dist/build/pdf.mjs", "public/vendor/pdf.mjs");
await copyFile("node_modules/pdfjs-dist/build/pdf.worker.mjs", "public/vendor/pdf.worker.mjs");

console.log("static files copied to public");
