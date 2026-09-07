import { rename } from "node:fs/promises";
await rename("site-dist/landing.html", "site-dist/index.html");
console.log("Standalone landing page ready in site-dist/.");
