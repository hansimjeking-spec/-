import { copyFile, mkdir } from "node:fs/promises";

await mkdir("public", { recursive: true });
await mkdir("public/vendor", { recursive: true });

for (const file of [
  "index.html",
  "styles.css",
  "app.js",
  "radar-enhancements.css",
  "radar-enhancements.js"
]) {
  await copyFile(file, `public/${file}`);
}

await copyFile(
  "node_modules/@ssabrojs/hwpxjs/dist/browser/hwpxjs.browser.mjs",
  "public/vendor/hwpxjs.browser.mjs"
);
await copyFile("node_modules/pdfjs-dist/build/pdf.mjs", "public/vendor/pdf.mjs");
await copyFile("node_modules/pdfjs-dist/build/pdf.worker.mjs", "public/vendor/pdf.worker.mjs");

console.log("static files copied to public");
