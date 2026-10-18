import type { KeycloakAdmin } from "./keycloak.js";

/**
 * Idempotent Keycloak realm contract from the identity and session design
 * (docs/project/identity-session-design.md#keycloak-configuration-contract).
 * Secrets are supplied by the caller and never stored in the repository.
 */
export type TeluniRealmOptions = Readonly<{
  realm: string;
  /** Browser-visible panel origin; the callback is `${publicOrigin}/api/auth/callback`. */
  publicOrigin: string;
  /** URL Keycloak uses to reach the API's back-channel logout route. */
  backchannelLogoutUrl: string;
  /** Access-token audience the API verifier expects. */
  apiAudience: string;
  webClientSecret: string;
  provisionerClientSecret: string;
  smtp?: Readonly<{ host: string; port: number; from: string }>;
}>;

export const webClientId = "teluni-web";
export const provisionerClientId = "teluni-provisioner";
export const principalAttribute = "orion_principal_id";

const uuidPattern =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

function expectOk(response: Response, action: string): void {
  if (!response.ok)
    throw new Error(`Keycloak ${action} failed with HTTP ${response.status}`);
}

function realmSettings(options: TeluniRealmOptions) {
  const secureOrigin = new URL(options.publicOrigin).protocol === "https:";
  return {
    realm: options.realm,
    enabled: true,
    // Public signup with mandatory email verification (P06/P07).
    registrationAllowed: true,
    registrationEmailAsUsername: true,
    loginWithEmailAllowed: true,
    duplicateEmailsAllowed: false,
    verifyEmail: true,
    resetPasswordAllowed: true,
    editUsernameAllowed: false,
    rememberMe: false,
    sslRequired: secureOrigin ? "all" : "external",
    // Progressive delays without attacker-triggered permanent lockout (P36).
    bruteForceProtected: true,
    permanentLockout: false,
    failureFactor: 10,
    waitIncrementSeconds: 60,
    maxFailureWaitSeconds: 900,
    maxDeltaTimeSeconds: 43_200,
    quickLoginCheckMilliSeconds: 1000,
    minimumQuickLoginWaitSeconds: 60,
    passwordPolicy:
      "length(12) and maxLength(128) and notUsername(undefined) and notEmail(undefined)",
    // Five-minute access tokens (P20); provider sessions never outlive the
    // application's 12-hour absolute and two-hour operator idle bounds (P17).
    accessTokenLifespan: 300,
    ssoSessionIdleTimeout: 7200,
    ssoSessionMaxLifespan: 43_200,
    offlineSessionIdleTimeout: 0,
    revokeRefreshToken: true,
    refreshTokenMaxReuse: 0,
    // User-initiated action tokens, including password reset, last 15 minutes (P15).
    actionTokenGeneratedByUserLifespan: 900,
    internationalizationEnabled: true,
    supportedLocales: ["pt-BR", "en"],
    defaultLocale: "pt-BR",
    adminEventsEnabled: true,
    adminEventsDetailsEnabled: false,
    eventsEnabled: true,
    ...(options.smtp
      ? {
          smtpServer: {
            host: options.smtp.host,
            port: String(options.smtp.port),
            from: options.smtp.from,
            fromDisplayName: "Teluni",
            ssl: "false",
            starttls: "false",
            auth: "false",
          },
        }
      : {}),
  };
}

function webClient(options: TeluniRealmOptions) {
  return {
    clientId: webClientId,
    name: "Teluni web panel",
    enabled: true,
    protocol: "openid-connect",
    publicClient: false,
    clientAuthenticatorType: "client-secret",
    secret: options.webClientSecret,
    standardFlowEnabled: true,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false,
    consentRequired: false,
    fullScopeAllowed: false,
    frontchannelLogout: false,
    redirectUris: [`${options.publicOrigin}/api/auth/callback`],
    webOrigins: [],
    attributes: {
      "pkce.code.challenge.method": "S256",
      "access.token.header.type.rfc9068": "true",
      "backchannel.logout.url": options.backchannelLogoutUrl,
      "backchannel.logout.session.required": "true",
      "backchannel.logout.revoke.offline.tokens": "false",
      "post.logout.redirect.uris": "",
      "oauth2.device.authorization.grant.enabled": "false",
      "oidc.ciba.grant.enabled": "false",
      "standard.token.exchange.enabled": "false",
      "use.refresh.tokens": "true",
    },
    defaultClientScopes: ["basic", "acr", "profile", "email"],
    optionalClientScopes: [],
    protocolMappers: [
      {
        name: "teluni api audience",
        protocol: "openid-connect",
        protocolMapper: "oidc-audience-mapper",
        config: {
          "included.custom.audience": options.apiAudience,
          "access.token.claim": "true",
          "id.token.claim": "false",
          "introspection.token.claim": "true",
        },
      },
      {
        // Keycloak introspection only answers for clients in the token's
        // audience; the API session boundary introspects as this client.
        name: "teluni web audience",
        protocol: "openid-connect",
        protocolMapper: "oidc-audience-mapper",
        config: {
          "included.client.audience": webClientId,
          "access.token.claim": "true",
          "id.token.claim": "false",
          "introspection.token.claim": "true",
        },
      },
      {
        name: "orion principal id",
        protocol: "openid-connect",
        protocolMapper: "oidc-usermodel-attribute-mapper",
        config: {
          "user.attribute": principalAttribute,
          "claim.name": principalAttribute,
          "jsonType.label": "String",
          multivalued: "false",
          "access.token.claim": "true",
          "id.token.claim": "false",
          "userinfo.token.claim": "false",
          "introspection.token.claim": "true",
        },
      },
      {
        // Only this human browser-login client asserts a human actor.
        name: "orion human actor",
        protocol: "openid-connect",
        protocolMapper: "oidc-hardcoded-claim-mapper",
        config: {
          "claim.name": "orion_actor_type",
          "claim.value": "human",
          "jsonType.label": "String",
          "access.token.claim": "true",
          "id.token.claim": "false",
          "userinfo.token.claim": "false",
          "introspection.token.claim": "true",
        },
      },
    ],
  };
}

function provisionerClient(options: TeluniRealmOptions) {
  return {
    clientId: provisionerClientId,
    name: "Teluni principal provisioner",
    enabled: true,
    protocol: "openid-connect",
    publicClient: false,
    clientAuthenticatorType: "client-secret",
    secret: options.provisionerClientSecret,
    standardFlowEnabled: false,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: true,
    consentRequired: false,
    redirectUris: [],
    webOrigins: [],
    attributes: {
      "oauth2.device.authorization.grant.enabled": "false",
      "oidc.ciba.grant.enabled": "false",
      "standard.token.exchange.enabled": "false",
      "client_credentials.use_refresh_token": "false",
    },
    defaultClientScopes: [],
    optionalClientScopes: [],
  };
}

async function upsertClient(
  admin: KeycloakAdmin,
  realm: string,
  representation: { clientId: string } & Record<string, unknown>,
): Promise<string> {
  const lookup = await admin.request(
    "GET",
    `/realms/${realm}/clients?clientId=${encodeURIComponent(representation.clientId)}`,
  );
  expectOk(lookup, "client lookup");
  const [existing] = (await lookup.json()) as { id: string }[];
  if (!existing) {
    expectOk(
      await admin.request("POST", `/realms/${realm}/clients`, representation),
      "client creation",
    );
    return upsertClient(admin, realm, representation);
  }
  const { protocolMappers, ...settings } = representation as {
    protocolMappers?: { name: string }[];
  } & Record<string, unknown>;
  expectOk(
    await admin.request("PUT", `/realms/${realm}/clients/${existing.id}`, {
      ...settings,
      id: existing.id,
    }),
    "client update",
  );
  if (protocolMappers) {
    const current = await admin.request(
      "GET",
      `/realms/${realm}/clients/${existing.id}/protocol-mappers/models`,
    );
    expectOk(current, "protocol mapper lookup");
    for (const mapper of (await current.json()) as { id: string }[])
      expectOk(
        await admin.request(
          "DELETE",
          `/realms/${realm}/clients/${existing.id}/protocol-mappers/models/${mapper.id}`,
        ),
        "protocol mapper removal",
      );
    expectOk(
      await admin.request(
        "POST",
        `/realms/${realm}/clients/${existing.id}/protocol-mappers/add-models`,
        protocolMappers,
      ),
      "protocol mapper creation",
    );
  }
  return existing.id;
}

/** Grants the provisioner only user viewing/management in its own realm. */
async function grantProvisionerRoles(
  admin: KeycloakAdmin,
  realm: string,
  clientUuid: string,
): Promise<void> {
  const serviceAccount = await admin.request(
    "GET",
    `/realms/${realm}/clients/${clientUuid}/service-account-user`,
  );
  expectOk(serviceAccount, "service account lookup");
  const { id: userId } = (await serviceAccount.json()) as { id: string };
  const management = await admin.request(
    "GET",
    `/realms/${realm}/clients?clientId=realm-management`,
  );
  expectOk(management, "realm-management lookup");
  const [{ id: managementId }] = (await management.json()) as { id: string }[];
  const roles = [];
  for (const name of ["view-users", "manage-users"]) {
    const role = await admin.request(
      "GET",
      `/realms/${realm}/clients/${managementId}/roles/${name}`,
    );
    expectOk(role, "role lookup");
    roles.push(await role.json());
  }
  expectOk(
    await admin.request(
      "POST",
      `/realms/${realm}/users/${userId}/role-mappings/clients/${managementId}`,
      roles,
    ),
    "provisioner role grant",
  );
}

/** Makes the principal attribute administrator-only and disables unmanaged attributes. */
async function configureUserProfile(
  admin: KeycloakAdmin,
  realm: string,
): Promise<void> {
  const current = await admin.request("GET", `/realms/${realm}/users/profile`);
  expectOk(current, "user profile lookup");
  const profile = (await current.json()) as {
    attributes: { name: string }[];
    unmanagedAttributePolicy?: string;
  } & Record<string, unknown>;
  const attributes = profile.attributes.filter(
    (attribute) => attribute.name !== principalAttribute,
  );
  attributes.push({
    name: principalAttribute,
    displayName: "Teluni principal",
    validations: { pattern: { pattern: uuidPattern } },
    permissions: { view: ["admin"], edit: ["admin"] },
    multivalued: false,
  } as { name: string });
  const { unmanagedAttributePolicy, ...rest } = profile;
  void unmanagedAttributePolicy;
  expectOk(
    await admin.request("PUT", `/realms/${realm}/users/profile`, {
      ...rest,
      attributes,
    }),
    "user profile update",
  );
}

export async function provisionTeluniRealm(
  admin: KeycloakAdmin,
  options: TeluniRealmOptions,
): Promise<void> {
  const existing = await admin.request("GET", `/realms/${options.realm}`);
  if (existing.status === 404)
    expectOk(
      await admin.request("POST", "/realms", realmSettings(options)),
      "realm creation",
    );
  else {
    expectOk(existing, "realm lookup");
    expectOk(
      await admin.request(
        "PUT",
        `/realms/${options.realm}`,
        realmSettings(options),
      ),
      "realm update",
    );
  }
  await configureUserProfile(admin, options.realm);
  await upsertClient(admin, options.realm, webClient(options));
  const provisioner = await upsertClient(
    admin,
    options.realm,
    provisionerClient(options),
  );
  await grantProvisionerRoles(admin, options.realm, provisioner);
}
