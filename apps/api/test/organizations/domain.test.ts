import { describe, expect, it } from "vitest";
import { renderInvitationEmail } from "../../src/features/organizations/invitation-email.js";
import {
  auditVisibility,
  branchReach,
  companyAccess,
  decide,
  grantRequest,
  invitationDecision,
  invitationVisibility,
  isTimeZone,
  OrganizationFailure,
  profileCapabilities,
  reachableWithStrongAuthentication,
  requireCapability,
  type Grant,
} from "../../src/features/organizations/domain.js";

const access = (
  grants: Grant[],
  strong = false,
  status: "ACTIVE" | "SUSPENDED" = "ACTIVE",
) =>
  companyAccess({
    companyId: "company",
    companyStatus: status,
    membershipId: "membership",
    principalId: "principal",
    responsible: false,
    grants,
    strong,
  });

describe("organization access decisions", () => {
  const manager: Grant = {
    role: "BRANCH_MANAGER",
    scope: "BRANCHES",
    branchIds: new Set(["north"]),
  };
  const operator: Grant = {
    role: "OPERATOR",
    scope: "BRANCHES",
    branchIds: new Set(["south"]),
  };

  it("denies without grants and counts administrator grants only when strong", () => {
    expect(decide(access([]), "branches.view", "north")).toBe("deny");
    const admin: Grant = { role: "COMPANY_ADMINISTRATOR", scope: "COMPANY" };
    expect(decide(access([admin]), "branches.manage")).toBe("strong_required");
    expect(decide(access([admin], true), "branches.manage", "any")).toBe(
      "allow",
    );
  });

  it("combines branch-scoped grants additively and never reaches new branches", () => {
    const combined = access([manager, operator], true);
    expect(branchReach(combined, "branches.view")).toEqual(
      new Set(["north", "south"]),
    );
    expect(decide(combined, "branches.view", "east")).toBe("deny");
    // In a standard session only the operator grant counts.
    expect(branchReach(access([manager, operator]), "branches.view")).toEqual(
      new Set(["south"]),
    );
    expect(decide(access([manager]), "branches.view", "north")).toBe(
      "strong_required",
    );
  });

  it("lets every member see basic company information but not administer it", () => {
    expect(decide(access([operator]), "company.view")).toBe("allow");
    expect(decide(access([operator]), "company.settings.manage")).toBe("deny");
    expect(() =>
      requireCapability(access([operator], false, "SUSPENDED"), "company.view"),
    ).toThrow(new OrganizationFailure("COMPANY_SUSPENDED"));
  });

  it("keeps administration company-wide and branch scopes explicit and distinct", () => {
    expect(
      grantRequest({
        role: "OPERATOR",
        scope: "BRANCHES",
        branchIds: ["south", "north"],
      }),
    ).toEqual({
      role: "OPERATOR",
      scope: "BRANCHES",
      branchIds: ["north", "south"],
    });
    expect(
      grantRequest({ role: "COMPANY_ADMINISTRATOR", scope: "COMPANY" }),
    ).toEqual({
      role: "COMPANY_ADMINISTRATOR",
      scope: "COMPANY",
      branchIds: [],
    });
    const tooMany = Array.from({ length: 101 }, (_, index) => `b${index}`);
    for (const input of [
      {
        role: "COMPANY_ADMINISTRATOR",
        scope: "BRANCHES",
        branchIds: ["north"],
      },
      { role: "OPERATOR", scope: "COMPANY", branchIds: ["north"] },
      { role: "BRANCH_MANAGER", scope: "BRANCHES" },
      { role: "BRANCH_MANAGER", scope: "BRANCHES", branchIds: [] },
      { role: "OPERATOR", scope: "BRANCHES", branchIds: ["north", "north"] },
      { role: "OPERATOR", scope: "BRANCHES", branchIds: tooMany },
    ] as const)
      expect(() => grantRequest(input)).toThrow(
        new OrganizationFailure("VALIDATION_FAILED"),
      );
  });

  it("lets administrators, the responsible administrator and branch managers invite only within their authority", () => {
    const admin: Grant = { role: "COMPANY_ADMINISTRATOR", scope: "COMPANY" };
    const operatorNorth = {
      role: "OPERATOR",
      scope: "BRANCHES",
      branchIds: ["north"],
    } as const;
    expect(invitationDecision(access([admin], true), operatorNorth)).toBe(
      "allow",
    );
    expect(
      invitationDecision(access([admin], true), {
        role: "COMPANY_ADMINISTRATOR",
        scope: "COMPANY",
        branchIds: [],
      }),
    ).toBe("responsible_required");
    expect(invitationDecision(access([manager], true), operatorNorth)).toBe(
      "allow",
    );
    expect(invitationDecision(access([manager], false), operatorNorth)).toBe(
      "strong_required",
    );
    for (const request of [
      { role: "OPERATOR", scope: "BRANCHES", branchIds: ["south"] },
      { role: "OPERATOR", scope: "COMPANY", branchIds: [] },
      { role: "BRANCH_MANAGER", scope: "BRANCHES", branchIds: ["north"] },
    ] as const)
      expect(invitationDecision(access([manager], true), request)).toBe("deny");
    expect(invitationDecision(access([operator], true), operatorNorth)).toBe(
      "deny",
    );
    expect(invitationVisibility(access([admin], true))).toEqual({
      kind: "all",
    });
    expect(invitationVisibility(access([manager], true))).toEqual({
      kind: "operators",
      branches: ["north"],
    });
    expect(invitationVisibility(access([operator], true))).toBeNull();
  });

  it("limits branch managers' audit to their branches and hides it from operators", () => {
    const admin: Grant = { role: "COMPANY_ADMINISTRATOR", scope: "COMPANY" };
    expect(auditVisibility(access([admin], true))).toEqual({ kind: "all" });
    expect(auditVisibility(access([manager, operator], true))).toEqual({
      kind: "branches",
      branches: ["north"],
    });
    expect(
      auditVisibility(
        access([{ role: "BRANCH_MANAGER", scope: "COMPANY" }], true),
      ),
    ).toEqual({ kind: "branches", branches: "all" });
    // Without strong authentication or as an operator, nothing is visible.
    expect(auditVisibility(access([admin]))).toBeNull();
    expect(auditVisibility(access([manager]))).toBeNull();
    expect(auditVisibility(access([operator], true))).toBeNull();
    // A branch grant never turns into company-level audit access.
    expect(decide(access([manager], true), "audit.view")).toBe("deny");
  });

  it("confers a profile's capabilities with per-capability assurance and never administration", () => {
    const auditor: Grant = {
      profileId: "profile",
      profileName: "Auditor",
      capabilities: new Set(["branches.view", "audit.view"]),
      scope: "BRANCHES",
      branchIds: new Set(["north"]),
    };
    // Every profile sees basic company information; read-only capabilities
    // work in a standard session while sensitive ones need two steps.
    expect(decide(access([auditor]), "company.view")).toBe("allow");
    expect(decide(access([auditor]), "branches.view", "north")).toBe("allow");
    expect(decide(access([auditor]), "branches.view", "south")).toBe("deny");
    expect(auditVisibility(access([auditor]))).toBeNull();
    expect(
      reachableWithStrongAuthentication(access([auditor]), "audit.view"),
    ).toBe(true);
    expect(auditVisibility(access([auditor], true))).toEqual({
      kind: "branches",
      branches: ["north"],
    });
    expect(invitationVisibility(access([auditor], true))).toBeNull();
    // An operator's additional grant to pair screens needs two steps; viewing
    // screens does not.
    const screens: Grant = {
      profileId: "screens",
      profileName: "Screens",
      capabilities: new Set(["devices.view", "devices.manage"]),
      scope: "BRANCHES",
      branchIds: new Set(["north"]),
    };
    expect(decide(access([screens]), "devices.view", "north")).toBe("allow");
    expect(decide(access([screens]), "devices.manage", "north")).toBe(
      "strong_required",
    );
    expect(decide(access([screens], true), "devices.manage", "north")).toBe(
      "allow",
    );
    expect(decide(access([screens], true), "devices.manage", "south")).toBe(
      "deny",
    );
    for (const capability of [
      "members.manage",
      "branches.manage",
      "company.settings.manage",
    ] as const)
      expect(decide(access([auditor], true), capability)).toBe("deny");
  });

  it("accepts only delegable, distinct profile capabilities in a stable order", () => {
    expect(
      profileCapabilities([
        "devices.manage",
        "audit.view",
        "devices.view",
        "branches.view",
      ]),
    ).toEqual([
      "branches.view",
      "audit.view",
      "devices.view",
      "devices.manage",
    ]);
    for (const requested of [
      [],
      ["members.manage"],
      ["company.view"],
      ["audit.view", "audit.view"],
      // An action whose view capability is missing would find nothing.
      ["devices.manage"],
      ["media.upload"],
      ["media.archive", "devices.view"],
      ["programming.assign"],
      ["publications.publish"],
    ])
      expect(() => profileCapabilities(requested)).toThrow(OrganizationFailure);
  });

  it("renders the invitation email with escaped names and one panel link", () => {
    const email = renderInvitationEmail({
      locale: "en-US",
      parameters: {
        acceptUrl: "https://app.example.test/invitations/accept",
        companyName: "<b>Café</b>\r\nBcc: x@example.test",
        inviterName: "",
        role: "BRANCH_MANAGER",
        expiresAt: "2026-10-25T12:00:00.000Z",
        timeZone: "America/Sao_Paulo",
      },
      secret: "s".repeat(43),
    });
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.text).toContain("You have been invited");
    expect(email.text).toContain("as a branch manager");
    expect(email.text).toContain(
      `https://app.example.test/invitations/accept#${"s".repeat(43)}`,
    );
    expect(email.html).toContain("&lt;b&gt;Café&lt;/b&gt;");
    expect(email.html).not.toContain("<b>Café");
    expect(() =>
      renderInvitationEmail({ locale: "pt-BR", parameters: {}, secret: null }),
    ).toThrow();
  });

  it("accepts only IANA time zones known to the runtime", () => {
    expect(isTimeZone("America/Sao_Paulo")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("../etc/passwd")).toBe(false);
  });
});
