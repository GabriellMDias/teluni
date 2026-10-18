import type { paths } from "@teluni/sdk";
import { ApiFailure, unwrap } from "../api-client.js";
import { identityErrorCodes, sessionApiClient } from "../identity/api.js";
import type { Locale } from "../locale.js";

export const organizationErrorCodes: ReadonlySet<string> = new Set([
  ...identityErrorCodes,
  "PERMISSION_DENIED",
  "COMPANY_SUSPENDED",
  "RESOURCE_VERSION_CONFLICT",
  "IDEMPOTENCY_KEY_REUSED",
  "BRANCH_NAME_IN_USE",
  "BRANCH_ARCHIVED",
]);

type CompanyWithAccess =
  paths["/companies/{companyId}"]["get"]["responses"][200]["content"]["application/json"];
export type CompanySummary =
  paths["/companies"]["get"]["responses"][200]["content"]["application/json"]["items"][number];
export type Access = CompanyWithAccess["access"];
export type Company = CompanyWithAccess["company"];
export type Capability = Access["capabilities"][number];
export type Role = Access["roles"][number];
export type Branch =
  paths["/companies/{companyId}/branches"]["post"]["responses"][201]["content"]["application/json"];

export const companiesKey = ["organizations", "companies"] as const;
export const companyKey = (id: string) =>
  ["organizations", "company", id] as const;
export const branchesKey = (id: string) =>
  ["organizations", "branches", id] as const;

const client = sessionApiClient;

export async function listCompanies(): Promise<readonly CompanySummary[]> {
  return unwrap(await client().GET("/companies"), organizationErrorCodes).items;
}

export async function createCompany(
  input: { displayName: string; defaultLocale: Locale; timeZone: string },
  idempotencyKey: string,
): Promise<{ company: Company; access: Access }> {
  return unwrap(
    await client().POST("/companies", {
      params: { header: { "idempotency-key": idempotencyKey } },
      body: input,
    }),
    organizationErrorCodes,
  );
}

export async function getCompany(
  companyId: string,
): Promise<{ company: Company; access: Access }> {
  return unwrap(
    await client().GET("/companies/{companyId}", {
      params: { path: { companyId } },
    }),
    organizationErrorCodes,
  );
}

export async function listBranches(
  companyId: string,
  cursor?: string,
): Promise<{ items: Branch[]; nextCursor: string | null }> {
  return unwrap(
    await client().GET("/companies/{companyId}/branches", {
      params: { path: { companyId }, query: cursor ? { cursor } : {} },
    }),
    organizationErrorCodes,
  );
}

export async function createBranch(
  companyId: string,
  name: string,
): Promise<Branch> {
  return unwrap(
    await client().POST("/companies/{companyId}/branches", {
      params: { path: { companyId } },
      body: { name },
    }),
    organizationErrorCodes,
  );
}

export async function renameBranch(
  companyId: string,
  branch: Branch,
  name: string,
): Promise<Branch> {
  return unwrap(
    await client().PATCH("/companies/{companyId}/branches/{branchId}", {
      params: { path: { companyId, branchId: branch.id } },
      body: { expectedVersion: branch.version, name },
    }),
    organizationErrorCodes,
  );
}

export async function archiveBranch(
  companyId: string,
  branch: Branch,
): Promise<Branch> {
  return unwrap(
    await client().POST("/companies/{companyId}/branches/{branchId}/archive", {
      params: { path: { companyId, branchId: branch.id } },
      body: { expectedVersion: branch.version },
    }),
    organizationErrorCodes,
  );
}

/** Localized failure text; a failed or lost write is an unknown outcome. */
export function describe(
  error: unknown,
  t: {
    errors: Record<string, string>;
    network: string;
    unknownWrite: string;
    generic: string;
  },
  operation: "read" | "write",
): string {
  if (!(error instanceof ApiFailure))
    return operation === "write" ? t.unknownWrite : t.network;
  if (
    error.status >= 500 &&
    operation === "write" &&
    error.code !== "SERVICE_UNAVAILABLE"
  )
    return t.unknownWrite;
  return t.errors[error.code] ?? t.generic;
}
