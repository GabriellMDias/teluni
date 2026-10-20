import { createHash } from "node:crypto";
import rateLimit, {
  normalizeIP,
  type RateLimitPluginOptions,
} from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";

// Screens present a bearer credential on every request, and many share one
// client address: a store's router, or the ingress proxy in front of the API.
// The limits taken before authentication therefore count each presented
// credential on its own, under a much higher ceiling per address that bounds
// floods of unknown credentials. Addresses are normalized as the plugin's
// default key does, so an IPv6 client counts once per subnet.

type Limit = Readonly<{ max: number; timeWindow: number }>;

export type DeviceRequestLimits = Readonly<{
  /** Requests per presented credential and window (per address without one). */
  perCredential: Limit;
  /** Requests per client address and window, whatever the credential. */
  perAddress: Limit;
}>;

/**
 * The default ceiling per address: enough for thousands of screens syncing
 * through one proxy, while a single address cannot flood authentication.
 */
export const deviceAddressCeiling: Limit = { max: 6_000, timeWindow: 60_000 };

/** The per-credential key: a digest, so the limiter never stores a credential. */
export function deviceRequestKey(request: {
  headers: { authorization?: string | undefined };
  ip: string;
}): string {
  const presented = request.headers.authorization;
  return presented
    ? `credential:${createHash("sha256").update(presented).digest("base64url")}`
    : `address:${normalizeIP(request.ip)}`;
}

/**
 * Registers both limits in the encapsulated context of a module's screen
 * routes. Exceeding either answers `RATE_LIMITED` with `Retry-After`.
 */
export async function registerDeviceRequestLimits(
  feature: FastifyInstance,
  limits: DeviceRequestLimits,
  headers: Pick<RateLimitPluginOptions, "addHeadersOnExceeding" | "addHeaders">,
): Promise<void> {
  await feature.register(rateLimit, {
    ...limits.perCredential,
    keyGenerator: deviceRequestKey,
    hook: "onRequest",
    ...headers,
  });
  const perAddress = feature.createRateLimit({
    ...limits.perAddress,
    keyGenerator: (request) => normalizeIP(request.ip),
  });
  feature.addHook("onRequest", async (request, reply) => {
    const limit = await perAddress(request);
    if (limit.isAllowed || !limit.isExceeded) return;
    reply.header("retry-after", String(limit.ttlInSeconds));
    throw Object.assign(new Error("Too many screen requests from an address"), {
      statusCode: 429,
    });
  });
}
