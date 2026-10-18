import type { ApiModule } from "./module.js";
import { createIdentityModule } from "./features/identity/module.js";

// Composition owned by this repository. Add each API module here; the shared
// runtime activates the ones whose requirements are configured. A module that
// uses another module's public capabilities is listed after it.
const identity = createIdentityModule();

export const apiModules: readonly ApiModule[] = [identity.module];
