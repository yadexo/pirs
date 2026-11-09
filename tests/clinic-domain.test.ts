import { describe, it, expect } from "vitest";
import { ROOT_DOMAIN, CLIENT_HOST, PORTAL_HOST, ADMIN_HOST } from "@/lib/portal-hosts";
import { checkClinicDomain, dnsRecordsFor, normaliseDomainInput, refusalMessage, VERCEL_CNAME_TARGET, type DomainRefusal } from "@/lib/clinic-domain";

const refusedFor = (input: string): DomainRefusal | null => {
  const result = checkClinicDomain(input);
  return result.ok ? null : result.reason;
};
const accepted = (input: string): string | null => {
  const result = checkClinicDomain(input);
  return result.ok ? result.host : null;
};

describe("reading what somebody typed", () => {
  it("takes the host out of whatever shape it arrives in", () => {
    for (const input of [
      "app.clinicname.nl",
      "  app.clinicname.nl  ",
      "APP.ClinicName.NL",
      "https://app.clinicname.nl",
      "http://app.clinicname.nl/",
      "https://app.clinicname.nl/some/page?x=1",
      "app.clinicname.nl:443",
      "app.clinicname.nl.",
    ]) {
      expect(normaliseDomainInput(input), input).toBe("app.clinicname.nl");
    }
  });

  it("is empty for nothing at all", () => {
    for (const input of ["", "   ", "\n"]) expect(normaliseDomainInput(input)).toBe("");
  });
});

describe("what a clinic may attach", () => {
  it("accepts a subdomain of the clinic's own domain", () => {
    expect(accepted("app.clinicname.nl")).toBe("app.clinicname.nl");
    expect(accepted("my-clinic.example.org")).toBe("my-clinic.example.org");
    expect(accepted("https://App.ClinicName.nl/")).toBe("app.clinicname.nl");
    // Deeper is fine too.
    expect(accepted("app.booking.clinicname.nl")).toBe("app.booking.clinicname.nl");
  });

  it("refuses an apex, which cannot carry a CNAME anyway", () => {
    expect(refusedFor("clinicname.nl")).toBe("apex");
    expect(refusedFor("https://clinicname.nl")).toBe("apex");
  });

  it("refuses our own domain, in every shape", () => {
    expect(refusedFor(ROOT_DOMAIN)).toBe("platform_domain");
    expect(refusedFor(`www.${ROOT_DOMAIN}`)).toBe("platform_domain");
    expect(refusedFor(`anything.${ROOT_DOMAIN}`)).toBe("platform_domain");
    for (const host of [CLIENT_HOST, PORTAL_HOST, ADMIN_HOST]) expect(refusedFor(host), host).toBe("platform_domain");
  });

  it("is not fooled by a domain that merely ends like ours", () => {
    // notdeza.ai is somebody else's domain and must not be read as ours.
    expect(accepted(`app.not${ROOT_DOMAIN}`)).toBe(`app.not${ROOT_DOMAIN}`);
    // But a real subdomain of ours is still ours, however deep.
    expect(refusedFor(`a.b.c.${ROOT_DOMAIN}`)).toBe("platform_domain");
  });

  it("refuses the hosting provider's own domains", () => {
    expect(refusedFor("my-app.vercel.app")).toBe("provider_domain");
    expect(refusedFor("something.vercel.sh")).toBe("provider_domain");
  });

  it("refuses names that cannot be reached from the internet", () => {
    expect(refusedFor("localhost")).toBe("localhost");
    expect(refusedFor("app.localhost")).toBe("localhost");
    expect(refusedFor("app.example.test")).toBe("localhost");
    expect(refusedFor("clinic.local")).toBe("localhost");
  });

  it("refuses an address where a name belongs", () => {
    expect(refusedFor("203.0.113.10")).toBe("ip_address");
    expect(refusedFor("[2001:db8::1]")).toBe("ip_address");
  });

  it("takes the host out of a pasted link rather than refusing it", () => {
    expect(accepted("https://app.clinicname.nl/some/page")).toBe("app.clinicname.nl");
  });

  it("refuses things that are not host names", () => {
    for (const input of ["app clinic.nl", "app..clinicname.nl", "-app.clinicname.nl", "app-.clinicname.nl", "app.clinic_name.nl"]) {
      expect(refusedFor(input), input).toBe("not_a_host");
    }
  });

  it("refuses nothing at all, and something absurdly long", () => {
    expect(refusedFor("")).toBe("empty");
    expect(refusedFor(["a","b","c","d","e"].map((c) => c.repeat(60)).join(".") + ".nl")).toBe("too_long");
  });

  it("has something to say for every refusal", () => {
    const reasons: DomainRefusal[] = ["empty", "not_a_host", "apex", "platform_domain", "provider_domain", "localhost", "ip_address", "too_long"];
    for (const reason of reasons) {
      const message = refusalMessage(reason);
      expect(message.length, reason).toBeGreaterThan(10);
      expect(message.endsWith("."), reason).toBe(true);
    }
  });
});

describe("the records a clinic's DNS editor needs", () => {
  it("asks for a CNAME on the subdomain, not on the whole host", () => {
    // Typing the full host into the name field is the usual way this goes
    // wrong, so the record says "app", not "app.clinicname.nl".
    expect(dnsRecordsFor("app.clinicname.nl")).toEqual([
      { type: "CNAME", name: "app", value: VERCEL_CNAME_TARGET, why: expect.any(String) },
    ]);
    expect(dnsRecordsFor("app.booking.clinicname.nl")[0]).toMatchObject({ name: "app.booking" });
  });

  it("adds the ownership record when Vercel asks for one", () => {
    const records = dnsRecordsFor("app.clinicname.nl", [
      { type: "TXT", domain: "_vercel.clinicname.nl", value: "vc-domain-verify=abc123", reason: "pending_domain_verification" },
    ]);
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({ type: "TXT", name: "_vercel", value: "vc-domain-verify=abc123" });
  });

  it("ignores a challenge that is not a TXT record", () => {
    const records = dnsRecordsFor("app.clinicname.nl", [{ type: "CNAME", domain: "x.clinicname.nl", value: "y" }]);
    expect(records).toHaveLength(1);
  });
});
