import { Type } from "typebox";
import {
  common,
  companyParams,
  cursor,
  grantScope,
  instant,
  limit,
  mutation,
  name,
  role,
  scoped,
  session,
  uuid,
} from "./contracts.js";

const invitationStatus = Type.Union([
  Type.Literal("PENDING"),
  Type.Literal("ACCEPTED"),
  Type.Literal("REVOKED"),
  Type.Literal("REPLACED"),
  Type.Literal("EXPIRED"),
]);
const deliveryState = Type.Union([
  Type.Literal("PENDING"),
  Type.Literal("SENT"),
  Type.Literal("FAILED"),
  Type.Literal("CANCELLED"),
  Type.Null(),
]);
const branchList = Type.Array(
  Type.Object({ id: uuid, name }, { additionalProperties: false }),
);
export const invitationSchema = Type.Object(
  {
    id: uuid,
    recipientEmail: Type.Union([Type.String(), Type.Null()]),
    role,
    scope: grantScope,
    branches: branchList,
    grantExpiresAt: Type.Union([instant, Type.Null()]),
    status: invitationStatus,
    delivery: deliveryState,
    invitedByName: Type.Union([Type.String(), Type.Null()]),
    createdAt: instant,
    expiresAt: instant,
  },
  { additionalProperties: false },
);
const invitationParams = Type.Object(
  { companyId: uuid, invitationId: uuid },
  { additionalProperties: false },
);
const credentialBody = Type.Object(
  { credential: Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" }) },
  { additionalProperties: false },
);
const previewSchema = Type.Object(
  {
    companyId: uuid,
    companyName: Type.String(),
    role,
    scope: grantScope,
    branches: branchList,
    grantExpiresAt: Type.Union([instant, Type.Null()]),
    expiresAt: instant,
    invitedByName: Type.Union([Type.String(), Type.Null()]),
    status: Type.Union([Type.Literal("PENDING"), Type.Literal("ACCEPTED")]),
  },
  { additionalProperties: false },
);
const acceptedSchema = Type.Object(
  { companyId: uuid, membershipId: uuid },
  { additionalProperties: false },
);

export const invitationOperations = [
  {
    method: "POST",
    url: "/companies/:companyId/invitations",
    operationId: "createInvitation",
    access: "session",
    description:
      "Invite a recipient address to the company with one grant: a role over the whole company or explicit active branches, optionally until an expiry instant. Company administrators invite operators and branch managers; only the responsible administrator, with an authentication no older than five minutes, invites administrators (always company-wide); branch managers invite operators to branches they manage. The invitation is valid for seven days and its email is delivered at least once after commit. One pending invitation per address and company; abuse limits answer RATE_LIMITED.",
    schema: {
      params: companyParams,
      body: Type.Object(
        {
          email: Type.String({ minLength: 3, maxLength: 254 }),
          role,
          scope: grantScope,
          branchIds: Type.Optional(
            Type.Array(uuid, { minItems: 1, maxItems: 100 }),
          ),
          grantExpiresAt: Type.Optional(instant),
        },
        { additionalProperties: false },
      ),
      response: { 201: invitationSchema, ...common },
    },
    expectedErrors: [
      ...mutation,
      "RESPONSIBLE_APPROVAL_REQUIRED",
      "RECENT_AUTHENTICATION_REQUIRED",
      "INVITATION_PENDING",
    ],
  },
  {
    method: "GET",
    url: "/companies/:companyId/invitations",
    operationId: "listInvitations",
    access: "session",
    description:
      "The company's invitations visible to the caller, newest first, with their delivery state: every invitation for administrators, and operator invitations within the branches they manage for branch managers. Cursors are bound to the company, caller and visible scope.",
    schema: {
      params: companyParams,
      querystring: Type.Object(
        { limit, cursor },
        { additionalProperties: false },
      ),
      response: {
        200: Type.Object(
          {
            items: Type.Array(invitationSchema),
            nextCursor: Type.Union([Type.String(), Type.Null()]),
          },
          { additionalProperties: false },
        ),
        ...common,
      },
    },
    expectedErrors: [...scoped, "PERMISSION_DENIED"],
  },
  {
    method: "POST",
    url: "/companies/:companyId/invitations/:invitationId/resend",
    operationId: "resendInvitation",
    access: "session",
    description:
      "Replace a pending invitation with a new one to the same address and grant: the previous link stops working, its unsent email is cancelled and the new invitation is valid for seven days. The caller must currently be allowed to create that invitation.",
    schema: {
      params: invitationParams,
      response: { 201: invitationSchema, ...common },
    },
    expectedErrors: [
      ...mutation,
      "RESPONSIBLE_APPROVAL_REQUIRED",
      "RECENT_AUTHENTICATION_REQUIRED",
      "INVITATION_NO_LONGER_VALID",
    ],
  },
  {
    method: "POST",
    url: "/companies/:companyId/invitations/:invitationId/revoke",
    operationId: "revokeInvitation",
    access: "session",
    description:
      "Revoke a pending invitation and cancel its unsent email. Revoking a final invitation is a no-op.",
    schema: {
      params: invitationParams,
      response: { 204: Type.Null(), ...common },
    },
    expectedErrors: [...mutation],
  },
  {
    method: "POST",
    url: "/invitations/preview",
    operationId: "previewInvitation",
    access: "session",
    description:
      "Describe the invitation a credential refers to, without effect, to the signed-in person whose verified email is its recipient. The credential travels only in the body.",
    schema: {
      body: credentialBody,
      response: { 200: previewSchema, ...common },
    },
    expectedErrors: [
      ...session,
      "CSRF_VALIDATION_FAILED",
      "RESOURCE_NOT_FOUND",
      "INVITATION_NO_LONGER_VALID",
      "INVITATION_RECIPIENT_MISMATCH",
    ],
  },
  {
    method: "POST",
    url: "/invitations/accept",
    operationId: "acceptInvitation",
    access: "session",
    description:
      "Accept an invitation as the signed-in person whose verified email is its recipient. The inviter must still be able to grant it and the company and every branch must be active. Creates a membership, adds the grant to an active one, or refuses a suspended one; a removed person returns through a new membership. Repeating an acceptance returns the same result with 200.",
    schema: {
      body: credentialBody,
      response: { 201: acceptedSchema, 200: acceptedSchema, ...common },
    },
    expectedErrors: [
      ...session,
      "CSRF_VALIDATION_FAILED",
      "RESOURCE_NOT_FOUND",
      "INVITATION_NO_LONGER_VALID",
      "INVITATION_RECIPIENT_MISMATCH",
      "MEMBERSHIP_SUSPENDED",
    ],
  },
] as const;
