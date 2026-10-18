import { describe, expect, it } from "vitest";
import {
  branchReach,
  companyAccess,
  decide,
  isTimeZone,
  OrganizationFailure,
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

  it("accepts only IANA time zones known to the runtime", () => {
    expect(isTimeZone("America/Sao_Paulo")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("../etc/passwd")).toBe(false);
  });
});
