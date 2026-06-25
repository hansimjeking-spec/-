import { copyFile, mkdir } from "node:fs/promises";

await mkdir("public", { recursive: true });

for (const file of ["index.html", "styles.css", "app.js"]) {
  await copyFile(file, `public/${file}`);
}

console.log("static files copied to public");
