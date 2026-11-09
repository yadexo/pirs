import "server-only";
import type { VercelVerificationChallenge } from "@/lib/clinic-domain";

/**
 * The four things we ask Vercel to do with a clinic's domain: attach it to
 * the project, look at it, nudge it to verify, and remove it again.
 *
 * Everything goes through one `fetch`-shaped function so a test can hand it a
 * fake and never touch the network — the same shape lib/apple-pay-domains.ts
 * uses for Stripe. The token is read once, here, and never leaves: no caller
 * sees it, and no error message carries it (see `describeError`).
 */

export interface VercelConfig {
  token: string;
  projectId: string;
  /** Only for a project owned by a team, which is most of them. */
  teamId?: string;
}

/**
 * Null when the platform has not been given Vercel credentials, which is the
 * off switch for the whole feature: the panel says so and the actions refuse,
 * rather than half-attaching a domain nobody can verify.
 */
export function vercelConfig(env: NodeJS.ProcessEnv = process.env): VercelConfig | null {
  const token = (env.VERCEL_API_TOKEN ?? "").trim();
  const projectId = (env.VERCEL_PROJECT_ID ?? "").trim();
  if (!token || !projectId) return null;
  const teamId = (env.VERCEL_TEAM_ID ?? "").trim();
  return { token, projectId, ...(teamId ? { teamId } : {}) };
}

/** What Vercel tells us about a domain on the project. */
export interface VercelDomain {
  name: string;
  verified: boolean;
  /** Challenges to satisfy. Empty or absent once it is verified. */
  verification: VercelVerificationChallenge[];
}

export class VercelApiError extends Error {
  constructor(
    message: string,
    /** Vercel's own code, e.g. "domain_already_in_use" — safe to show. */
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "VercelApiError";
  }
}

export interface VercelDomainsApi {
  /** Attaches the domain to the project. Returns what Vercel knows about it straight away. */
  add(host: string): Promise<VercelDomain>;
  /** The domain's current state, or null when it is not on the project. */
  get(host: string): Promise<VercelDomain | null>;
  /** Asks Vercel to look at DNS again now. */
  verify(host: string): Promise<VercelDomain>;
  /** Detaches it. Succeeds when it was not there — removing twice is not an error. */
  remove(host: string): Promise<void>;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<Response>;

const BASE = "https://api.vercel.com";

interface VercelDomainResponse {
  name?: string;
  verified?: boolean;
  verification?: VercelVerificationChallenge[];
}

function toDomain(host: string, body: VercelDomainResponse): VercelDomain {
  return { name: body.name ?? host, verified: body.verified === true, verification: Array.isArray(body.verification) ? body.verification : [] };
}

export function vercelDomainsApi(config: VercelConfig, fetchImpl: FetchLike = fetch): VercelDomainsApi {
  const query = config.teamId ? `?teamId=${encodeURIComponent(config.teamId)}` : "";
  const project = encodeURIComponent(config.projectId);
  const headers = { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" };

  async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const response = await fetchImpl(`${BASE}${path}${query}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    } as never);
    const text = await response.text();
    let json: Record<string, unknown> = {};
    if (text) {
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // A gateway error page, not Vercel. Keep the status; drop the body,
        // which is somebody else's HTML and no use to an administrator.
        json = {};
      }
    }
    return { status: response.status, json };
  }

  /** Vercel's error shape is { error: { code, message } }. */
  function fail(status: number, json: Record<string, unknown>): never {
    const error = (json.error ?? {}) as { code?: string; message?: string };
    throw new VercelApiError(error.message ?? `Vercel returned ${status}.`, error.code ?? "unknown", status);
  }

  return {
    async add(host) {
      const { status, json } = await call("POST", `/v10/projects/${project}/domains`, { name: host });
      // Already attached to this project: the state we wanted, so treat the
      // conflict as success and read it back rather than failing a retry.
      if (status === 409) {
        const existing = await this.get(host);
        if (existing) return existing;
      }
      if (status >= 400) fail(status, json);
      return toDomain(host, json as VercelDomainResponse);
    },

    async get(host) {
      const { status, json } = await call("GET", `/v9/projects/${project}/domains/${encodeURIComponent(host)}`);
      if (status === 404) return null;
      if (status >= 400) fail(status, json);
      return toDomain(host, json as VercelDomainResponse);
    },

    async verify(host) {
      const { status, json } = await call("POST", `/v9/projects/${project}/domains/${encodeURIComponent(host)}/verify`);
      if (status >= 400) fail(status, json);
      return toDomain(host, json as VercelDomainResponse);
    },

    async remove(host) {
      const { status, json } = await call("DELETE", `/v9/projects/${project}/domains/${encodeURIComponent(host)}`);
      if (status === 404) return;
      if (status >= 400) fail(status, json);
    },
  };
}

/**
 * What to show an administrator when Vercel refuses.
 *
 * Vercel's own message for the cases that have an obvious human cause, a
 * plain sentence otherwise — never the exception's stack, and never the
 * token: the one message shown verbatim is Vercel's, which we do not write
 * and therefore cannot vouch for, so it is redacted on the way out.
 */
function redactToken(message: string, env: NodeJS.ProcessEnv = process.env): string {
  const token = (env.VERCEL_API_TOKEN ?? '').trim();
  return token ? message.split(token).join('[redacted]') : message;
}

export function describeError(err: unknown): string {
  if (err instanceof VercelApiError) {
    switch (err.code) {
      case "domain_already_in_use":
      case "domain_taken":
        return "That domain is already attached to another Vercel project. It has to be removed there first.";
      case "forbidden":
      case "not_authorized":
        return "Vercel refused the request. Check VERCEL_API_TOKEN and that it can reach this project.";
      case "invalid_domain":
        return "Vercel does not accept that domain.";
      default:
        return redactToken(err.message);
    }
  }
  // A network failure, a timeout, a DNS problem reaching Vercel itself.
  return "Could not reach Vercel. Try again in a moment.";
}
