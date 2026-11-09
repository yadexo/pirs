import { ADMIN_HOST, CLIENT_HOST, PORTAL_HOST, ROOT_DOMAIN, normaliseHost } from "@/lib/portal-hosts";

/**
 * What a clinic is allowed to point at this deployment, decided before
 * anything is written down or sent to Vercel.
 *
 * Pure and dependency-free on purpose: this is the rule everybody else
 * trusts — the action, the host map and the runbook — so it has to be
 * readable on its own and testable without a database.
 */

export type DomainRefusal =
  | "empty"
  | "not_a_host"
  /** An apex such as clinicname.nl. We only ever serve a subdomain. */
  | "apex"
  /** deza.ai itself, or anything under it. Ours, not theirs. */
  | "platform_domain"
  /** A preview or deployment host that belongs to the hosting provider. */
  | "provider_domain"
  | "localhost"
  | "ip_address"
  | "too_long";

export type DomainCheck = { ok: true; host: string } | { ok: false; reason: DomainRefusal };

/** One DNS label: letters, digits and inner hyphens, 1–63 characters. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * What was typed, reduced to a bare host: scheme, path, port, trailing dot
 * and surrounding space all removed. Not a validity check — that is below.
 */
export function normaliseDomainInput(input: string): string {
  const text = (input ?? "").trim();
  if (!text) return "";
  const withoutScheme = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const [hostAndPort = ""] = withoutScheme.split(/[/?#]/);
  return normaliseHost(hostAndPort);
}

/** Hosts that are this platform's own, in every shape they take. */
function isPlatformHost(host: string): boolean {
  if (host === ROOT_DOMAIN || host.endsWith(`.${ROOT_DOMAIN}`)) return true;
  return host === CLIENT_HOST || host === PORTAL_HOST || host === ADMIN_HOST;
}

/**
 * Whether a clinic may attach this host.
 *
 * Deliberately strict in one direction: a refusal here costs somebody a
 * support message, while a mistaken acceptance either hands a clinic a host
 * we cannot route, or — for anything under our own domain — lets one clinic's
 * DNS entry shadow the platform's own sign-in.
 */
export function checkClinicDomain(input: string): DomainCheck {
  const host = normaliseDomainInput(input);
  if (!host) return { ok: false, reason: "empty" };
  if (host.length > 253) return { ok: false, reason: "too_long" };

  // An address, not a name: Vercel will not issue a certificate for one.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return { ok: false, reason: "ip_address" };

  const labels = host.split(".");
  if (labels.some((label) => !LABEL.test(label))) return { ok: false, reason: "not_a_host" };

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".test") || host.endsWith(".local")) {
    return { ok: false, reason: "localhost" };
  }
  if (isPlatformHost(host)) return { ok: false, reason: "platform_domain" };
  // vercel.app and friends are the provider's; a clinic cannot own one, and
  // attaching one would collide with our own preview deployments.
  if (host.endsWith(".vercel.app") || host.endsWith(".vercel.sh")) return { ok: false, reason: "provider_domain" };

  // Three labels at least, so clinicname.nl is refused and app.clinicname.nl
  // is not. An apex cannot carry a CNAME, and taking over a clinic's whole
  // domain is a bigger thing than they are asking for.
  //
  // This is a heuristic about public suffixes, and it is wrong in one
  // direction only: co.uk and com.au style suffixes mean app.clinicname.co.uk
  // has four labels and passes, while the apex clinicname.co.uk has three and
  // also passes. Vercel refuses the apex CNAME afterwards; the screen shows
  // its reason. The alternative is shipping the public suffix list for one
  // check.
  if (labels.length < 3) return { ok: false, reason: "apex" };

  return { ok: true, host };
}

/** Message for a refusal, in the admin console's own English. */
export function refusalMessage(reason: DomainRefusal): string {
  switch (reason) {
    case "empty":
      return "Enter a domain.";
    case "apex":
      return "Use a subdomain such as app.clinicname.nl, not the domain itself — an apex cannot point here with a CNAME.";
    case "platform_domain":
      return "That domain is ours, not the clinic's.";
    case "provider_domain":
      return "That is a hosting provider's own domain, which a clinic cannot own.";
    case "localhost":
      return "That is a local-only name and cannot be reached from the internet.";
    case "ip_address":
      return "Enter a domain name, not an IP address.";
    case "too_long":
      return "That domain is too long.";
    case "not_a_host":
      return "That does not look like a domain name.";
  }
}

/**
 * The DNS records the clinic's own administrator has to create.
 *
 * The CNAME is always needed and is the same for every Vercel project. The
 * TXT records come from Vercel and only appear when it wants proof of
 * ownership — which it does when the domain is already attached to some other
 * Vercel project.
 */
export const VERCEL_CNAME_TARGET = "cname.vercel-dns.com";

export interface DnsRecord {
  type: "CNAME" | "TXT";
  /** The name as a DNS editor wants it: the subdomain, relative to the zone. */
  name: string;
  value: string;
  why: string;
}

export interface VercelVerificationChallenge {
  type: string;
  domain: string;
  value: string;
  reason?: string;
}

export function dnsRecordsFor(host: string, verification: VercelVerificationChallenge[] = []): DnsRecord[] {
  const labels = host.split(".");
  // Everything to the left of the registrable domain. A DNS editor asks for
  // the name relative to the zone, and typing the whole host there is the
  // single most common way this goes wrong.
  const subdomain = labels.slice(0, Math.max(1, labels.length - 2)).join(".");

  const records: DnsRecord[] = [
    { type: "CNAME", name: subdomain, value: VERCEL_CNAME_TARGET, why: "Points the subdomain at this deployment." },
  ];
  for (const challenge of verification) {
    if (challenge.type?.toUpperCase() !== "TXT") continue;
    const name = challenge.domain.endsWith(`.${labels.slice(-2).join(".")}`)
      ? challenge.domain.slice(0, -(labels.slice(-2).join(".").length + 1))
      : challenge.domain;
    records.push({ type: "TXT", name, value: challenge.value, why: "Proves the clinic owns the domain. Needed because it is already in use elsewhere." });
  }
  return records;
}
