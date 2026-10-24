import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Teluni's production build is the public product: the Living Documentation
// portal is an internal aid, selected by the foundation build boundary
// (owner direction, 2026-10-19). Fail when portal code or generated pages
// reach the build output.
const assets = resolve(import.meta.dirname, "../dist/assets");
const portalMarkers = [
  "Documentation sections",
  "Send request",
  "docs/project/implementation-plan",
];
for (const name of readdirSync(assets)) {
  if (!/\.(js|json)$/.test(name)) continue;
  const content = readFileSync(resolve(assets, name), "utf8");
  for (const marker of portalMarkers)
    if (content.includes(marker))
      throw new Error(
        `Developer documentation (${marker}) reached the production build in ${name}.`,
      );
}
process.stdout.write("Production build excludes the developer portal.\n");
