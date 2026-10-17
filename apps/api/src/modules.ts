import type { ApiModule } from "./module.js";

// Composition owned by this repository. Add each API module here; the shared
// runtime activates the ones whose requirements are configured.
export const apiModules: readonly ApiModule[] = [];
