import { describe, expect, it } from "vitest";
import { ApiFailure } from "../src/api-client.js";
import {
  describe as describeFailure,
  organizationErrorCodes,
} from "../src/organizations/api.js";
import { organizationMessages } from "../src/organizations/messages.js";

describe("organization failure guidance", () => {
  it("localizes public failures without displaying arbitrary server messages", () => {
    for (const locale of ["pt-BR", "en-US"] as const) {
      const t = organizationMessages[locale];
      for (const code of organizationErrorCodes) {
        expect(t.errors[code], `${locale}: ${code}`).toMatch(/\S/);
        expect(
          describeFailure(
            new ApiFailure(403, code, null, "private detail"),
            t,
            "read",
          ),
        ).toBe(t.errors[code]);
      }
      expect(
        describeFailure(
          new ApiFailure(400, "UNRECOGNIZED", null, "private detail"),
          t,
          "read",
        ),
      ).toBe(t.generic);
    }
  });

  it("distinguishes a denied write from a write whose outcome is unknown", () => {
    const t = organizationMessages["pt-BR"];
    expect(
      describeFailure(
        new ApiFailure(409, "RESOURCE_VERSION_CONFLICT", null, ""),
        t,
        "write",
      ),
    ).toBe(t.errors.RESOURCE_VERSION_CONFLICT);
    expect(
      describeFailure(
        new ApiFailure(500, "INTERNAL_ERROR", null, ""),
        t,
        "write",
      ),
    ).toBe(t.unknownWrite);
    expect(describeFailure(new TypeError("offline"), t, "write")).toBe(
      t.unknownWrite,
    );
    expect(describeFailure(new TypeError("offline"), t, "read")).toBe(
      t.network,
    );
  });
});
