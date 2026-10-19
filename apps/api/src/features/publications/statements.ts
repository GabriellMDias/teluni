// Signed authorization statements of the publication and synchronization
// design (ADR-0030): a compact JWS with ES256 (ECDSA P-256 with SHA-256)
// from the first key of the configured ring, whose public halves screens
// pin as a JSON Web Key Set.
import { createPublicKey, type KeyObject } from "node:crypto";
import { CompactSign, exportJWK } from "jose";
import type { AuthorizedPublication } from "./domain.js";

export type SigningKey = Readonly<{ id: string; privateKey: KeyObject }>;

export const statementType = "teluni-authorization+jws";

/** The claims a statement carries; times are seconds since the epoch. */
export type StatementClaims = Readonly<{
  sub: string;
  company: string;
  iat: number;
  exp: number;
  publications: readonly AuthorizedPublication[];
}>;

/** Signs the claims with the first key of the ring. */
export async function signStatement(
  keys: readonly SigningKey[],
  claims: StatementClaims,
): Promise<string> {
  const [key] = keys;
  return new CompactSign(
    new TextEncoder().encode(
      JSON.stringify({
        sub: claims.sub,
        company: claims.company,
        iat: claims.iat,
        exp: claims.exp,
        publications: claims.publications.map((item) => ({
          id: item.id,
          sha256: item.sha256,
        })),
      }),
    ),
  )
    .setProtectedHeader({ alg: "ES256", kid: key.id, typ: statementType })
    .sign(key.privateKey);
}

export type PublicKeySet = Readonly<{
  keys: readonly Readonly<{
    kty: "EC";
    crv: "P-256";
    x: string;
    y: string;
    kid: string;
    use: "sig";
    alg: "ES256";
  }>[];
}>;

/** The public half of every key of the ring, newest first. */
export async function publicKeySet(
  keys: readonly SigningKey[],
): Promise<PublicKeySet> {
  return {
    keys: await Promise.all(
      keys.map(async (key) => {
        const jwk = await exportJWK(createPublicKey(key.privateKey));
        return {
          kty: "EC" as const,
          crv: "P-256" as const,
          x: jwk.x!,
          y: jwk.y!,
          kid: key.id,
          use: "sig" as const,
          alg: "ES256" as const,
        };
      }),
    ),
  };
}
