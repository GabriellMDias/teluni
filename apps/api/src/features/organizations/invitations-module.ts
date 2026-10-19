import type { ApiModule } from "../../module.js";
import type { HumanProfilePort, HumanSessionPort } from "../identity/public.js";
import type { MailOutboxPort, MailTemplate } from "../mail/public.js";
import { invitationOperations } from "./invitation-contracts.js";
import { renderInvitationEmail } from "./invitation-email.js";
import {
  invitationTemplate,
  PrismaInvitationRepository,
} from "./invitation-repository.js";
import { registerInvitationRoutes } from "./invitation-routes.js";
import { InvitationService } from "./invitation-service.js";
import { invitationErrors } from "./errors.js";
import type { CompanyAccessPort } from "./public.js";

/**
 * Composes company invitations (D-13) as a module of its own, so the rest of
 * organizations works without mail while invitations require it. The
 * invitation template and its retention upkeep are registered with the mail
 * module at composition.
 */
export function createInvitationsModule(options: {
  sessions: HumanSessionPort;
  profiles: HumanProfilePort;
  companies: CompanyAccessPort;
  mail: Readonly<{
    outbox: MailOutboxPort;
    registerTemplate(name: string, template: MailTemplate): void;
    registerMaintenance(task: () => Promise<void>): void;
  }>;
  rateLimit?: { max: number; timeWindow: number };
}): ApiModule {
  let service: InvitationService | undefined;
  options.mail.registerTemplate(invitationTemplate, renderInvitationEmail);
  options.mail.registerMaintenance(async () => {
    await service?.maintain();
  });
  return {
    name: "invitations",
    tag: "Invitations",
    requires: ["database", "mail"],
    requiresModules: ["identity", "organizations", "mail"],
    operations: invitationOperations,
    errors: invitationErrors,
    activate: ({ database, mail }) => {
      // Activation guarantees the database, mail settings and modules.
      const active = new InvitationService({
        repository: new PrismaInvitationRepository(
          database!,
          options.mail.outbox,
        ),
        companies: options.companies,
        profiles: options.profiles,
        outbox: options.mail.outbox,
        publicOrigin: mail!.publicOrigin,
      });
      service = active;
      return {
        name: "invitations",
        register: (app) =>
          registerInvitationRoutes(
            app,
            active,
            options.sessions,
            options.rateLimit,
          ),
      };
    },
  };
}
