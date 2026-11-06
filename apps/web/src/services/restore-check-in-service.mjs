import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const parts = [];
for (let i = 0; ; i++) {
  const p = path.join(dir, `.check-in-service.b64.${i}`);
  if (!fs.existsSync(p)) break;
  parts.push(fs.readFileSync(p, "utf8"));
}
if (!parts.length) {
  console.error("missing check-in-service b64 parts");
  process.exit(1);
}
const out = path.join(dir, "check-in-service.ts");
fs.writeFileSync(out, Buffer.from(parts.join(""), "base64"));
console.log("restored", out, fs.statSync(out).size, "bytes");
