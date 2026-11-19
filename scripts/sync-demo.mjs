// Keep demo/engine.js identical to src/engine.js (the demo runs the real engine).
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
copyFileSync(join(root, "src/engine.js"), join(root, "demo/engine.js"));
console.log("demo/engine.js synced from src/engine.js");
