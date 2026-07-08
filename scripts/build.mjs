import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

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
  "radar-supabase.js",
  "radar-staff.css",
  "radar-staff.js",
  "radar-auth-guard.css",
  "radar-auth-guard.js"
]) {
  await copyFile(file, `public/${file}`);
}

let html = await readFile("public/index.html", "utf8");
const extraScripts = [
  "radar-staff.js",
  "radar-auth-guard.js"
];
for (const script of extraScripts) {
  if (!html.includes(script)) {
    html = html.replace("</body>", `  <script src="./${script}" type="module"></script>\n</body>`);
  }
}
await writeFile("public/index.html", html);

await copyFile("supabase-schema.sql", "public/supabase-schema.sql");
await copyFile(
  "node_modules/@ssabrojs/hwpxjs/dist/browser/hwpxjs.browser.mjs",
  "public/vendor/hwpxjs.browser.mjs"
);
await copyFile("node_modules/pdfjs-dist/build/pdf.mjs", "public/vendor/pdf.mjs");
await copyFile("node_modules/pdfjs-dist/build/pdf.worker.mjs", "public/vendor/pdf.worker.mjs");

console.log("static files copied to public");
