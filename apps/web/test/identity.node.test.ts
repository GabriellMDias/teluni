import { describe, expect, it } from "vitest";
import { ApiFailure } from "../src/api-client.js";
import { describeFailure } from "../src/identity/failures.js";
import {
  identityMessages,
  loginErrorReasons,
  preferredLocale,
} from "../src/identity/messages.js";

describe("identity localization", () => {
  it("defaults to Portuguese unless the browser prefers English", () => {
    expect(preferredLocale([])).toBe("pt-BR");
    expect(preferredLocale(["fr-FR", "es"])).toBe("pt-BR");
    expect(preferredLocale(["pt-PT", "en-US"])).toBe("pt-BR");
    expect(preferredLocale(["en-GB", "pt-BR"])).toBe("en-US");
  });

  it("translates every login failure the API can report in both locales", () => {
    for (const locale of ["pt-BR", "en-US"] as const)
      for (const reason of loginErrorReasons)
        expect(identityMessages[locale].loginErrors[reason]).toMatch(/\S/);
  });

  it("maps public codes to localized guidance and treats lost writes as unknown", () => {
    const t = identityMessages["pt-BR"];
    const failure = (status: number, code: string) =>
      new ApiFailure(status, code, null, "");
    expect(
      describeFailure(failure(403, "CSRF_VALIDATION_FAILED"), t, "write"),
    ).toBe(t.errors.csrf);
    expect(
      describeFailure(failure(409, "SESSION_LIMIT_REACHED"), t, "read"),
    ).toBe(t.errors.limit);
    expect(
      describeFailure(failure(401, "AUTHENTICATION_REQUIRED"), t, "read"),
    ).toBe(t.errors.signedOut);
    expect(describeFailure(failure(500, "INTERNAL_ERROR"), t, "write")).toBe(
      t.errors.unknownWrite,
    );
    expect(describeFailure(new TypeError("offline"), t, "read")).toBe(
      t.errors.network,
    );
    expect(describeFailure(new TypeError("offline"), t, "write")).toBe(
      t.errors.unknownWrite,
    );
  });
});
