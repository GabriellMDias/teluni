import type { ApiModule } from "./module.js";
import { createCatalogsModule } from "./features/catalogs/module.js";
import { createDevicesModule } from "./features/devices/module.js";
import { createIdentityModule } from "./features/identity/module.js";
import { createMailModule } from "./features/mail/module.js";
import { createMediaModule } from "./features/media/module.js";
import { createInvitationsModule } from "./features/organizations/invitations-module.js";
import { createOrganizationsModule } from "./features/organizations/module.js";
import { createProgrammingModule } from "./features/programming/module.js";
import { createPublicationsModule } from "./features/publications/module.js";

// Composition owned by this repository. Add each API module here; the shared
// runtime activates the ones whose requirements are configured. A module that
// uses another module's public capabilities is listed after it.
const identity = createIdentityModule();
const mail = createMailModule();
const organizations = createOrganizationsModule({
  sessions: identity.sessions,
  profiles: identity.profiles,
});
const invitations = createInvitationsModule({
  sessions: identity.sessions,
  profiles: identity.profiles,
  companies: organizations.companies,
  mail,
});
const devices = createDevicesModule({
  sessions: identity.sessions,
  companies: organizations.companies,
});
const media = createMediaModule({
  sessions: identity.sessions,
  companies: organizations.companies,
});
const programming = createProgrammingModule({
  sessions: identity.sessions,
  companies: organizations.companies,
  devices: devices.devices,
  media: media.media,
});
const catalogs = createCatalogsModule({
  sessions: identity.sessions,
  companies: organizations.companies,
  media: media.media,
});
const publications = createPublicationsModule({
  sessions: identity.sessions,
  companies: organizations.companies,
  devices: devices.devices,
  media: media.media,
  programming: programming.programming,
});

export const apiModules: readonly ApiModule[] = [
  identity.module,
  mail.module,
  organizations.module,
  invitations,
  devices.module,
  media.module,
  programming.module,
  catalogs.module,
  publications.module,
];
