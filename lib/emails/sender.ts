/**
 * "Clinic Name <no-reply@our-domain.com>" — the clinic's own name on the
 * From line, sent through our one verified sending address. EMAIL_FROM holds
 * that address (and may already carry its own display name, which this
 * replaces with the clinic's).
 */
export function senderFor(clinicName: string): string | undefined {
  const envFrom = process.env.EMAIL_FROM;
  if (!envFrom) return undefined;
  const m = /<([^>]+)>/.exec(envFrom);
  const address = (m?.[1] ?? envFrom).trim();
  if (!address) return undefined;
  // A clinic name can't carry <, > or " without breaking the header.
  const safeName = clinicName.replace(/["<>]/g, "").trim() || "Notifications";
  return `${safeName} <${address}>`;
}
