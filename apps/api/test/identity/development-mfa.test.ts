import { expect, it } from "vitest";
import { requireStrongAuthentication } from "../../src/features/identity/public.js";
import { createIdentityModule } from "../../src/features/identity/module.js";
import { createAccessTokenVerifier } from "../../src/authentication.js";
import { PanelBrowser, syntheticPerson, withIdentityStack } from "./stack.js";

it("waives local MFA after real login without persisting fabricated assurance or bypassing session checks", async () => {
  await withIdentityStack(
    async (stack) => {
      const person = await syntheticPerson(stack);
      const browser = new PanelBrowser(stack);
      // Even a recent step-up link must complete with password alone in optional
      // mode, without enrolling the synthetic authenticator.
      await browser.login(person.credentials, "/account/sessions", "recent");
      const response = await browser.request("/auth/session");
      expect(response.status).toBe(200);
      const summary = (await response.json()) as {
        sessionId: string;
        csrfToken: string;
        assuranceLevel: string;
      };
      expect(summary.assuranceLevel).toBe("teluni-development");
      const context = await stack.sessions.authenticate({
        method: "GET",
        headers: { cookie: browser.api.header() },
      });
      expect(context.strongAuthenticationAgeSeconds).toBe(0);
      expect(() =>
        requireStrongAuthentication(context, { recent: true }),
      ).not.toThrow();
      const stored = await stack.sql.query(
        "SELECT assurance_level, strong_authenticated_at FROM human_sessions WHERE id = $1",
        [summary.sessionId],
      );
      expect(stored.rows).toEqual([
        { assurance_level: "teluni-aal1", strong_authenticated_at: null },
      ]);
      const credentials = await stack.admin.request(
        "GET",
        `/realms/teluni/users/${person.userId}/credentials`,
      );
      expect(
        ((await credentials.json()) as { type: string }[]).map(
          (entry) => entry.type,
        ),
      ).toEqual(["password"]);
      // Recompose the boundary with the exception disabled over the same stored
      // cookie and key ring: the previous local projection grants no assurance.
      const strict = createIdentityModule();
      strict.module.activate({
        database: stack.database,
        humanIdentity: { ...stack.settings, developmentMfaMode: "required" },
        verifier: createAccessTokenVerifier({
          issuer: stack.issuer,
          audience: "teluni-api",
          jwksUrl: `${stack.issuer}/protocol/openid-connect/certs`,
        }),
      });
      const strictContext = await strict.sessions.authenticate({
        method: "GET",
        headers: { cookie: browser.api.header() },
      });
      expect(strictContext.assuranceLevel).toBe("teluni-aal1");
      expect(() => requireStrongAuthentication(strictContext)).toThrow(
        "STRONG_AUTHENTICATION_REQUIRED",
      );
      expect(
        (await browser.request("/auth/logout", { method: "POST" })).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${stack.apiUrl}/auth/session`, {
            headers: { authorization: "Bearer not-a-session" },
          })
        ).status,
      ).toBe(401);
      browser.csrfToken = summary.csrfToken;
      expect((await browser.mutate("/auth/logout")).status).toBe(204);
      expect((await browser.request("/auth/session")).status).toBe(401);
    },
    { developmentMfaMode: "optional" },
  );
}, 300_000);
