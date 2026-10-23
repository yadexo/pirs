/**
 * The one HTML shell every transactional email is built from: the clinic's
 * logo (or a monogram) on its brand colour, a white card for the message,
 * and a plain-text companion generated from the same content so a client
 * reading in a text-only mail app still gets the full message.
 *
 * Table layout and inline styles throughout — the only markup that survives
 * every mail client's HTML stripping. No external stylesheet, no web fonts.
 *
 * Unsubscribe is a parameter, not a default: a receipt or a password reset
 * is service mail, not an offer, and must never carry one. Only a marketing
 * send should ever pass `unsubscribeUrl`.
 */

export interface EmailBranding {
  name: string;
  logoUrl: string | null;
  /** The clinic's brand colour, hex. Falls back to a neutral dark when unset or invalid. */
  color: string | null;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function brandColor(color: string | null): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#111318";
}

/** A button-shaped link — the one piece of "interactive" most mail clients render reliably. */
export function emailButton(label: string, href: string, color: string | null): string {
  const bg = brandColor(color);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td style="border-radius:10px;background:${bg};">
    <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">${escapeHtml(label)}</a>
  </td></tr></table>`;
}

export function emailLayout(params: { branding: EmailBranding; preheader: string; bodyHtml: string; unsubscribeUrl?: string }): string {
  const { branding, preheader, bodyHtml, unsubscribeUrl } = params;
  const color = brandColor(branding.color);
  const name = escapeHtml(branding.name);
  const header = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${name}" height="36" style="height:36px;max-width:220px;object-fit:contain;" />`
    : `<span style="color:#ffffff;font-size:18px;font-weight:700;font-family:Helvetica,Arial,sans-serif;">${name}</span>`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${name}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:Helvetica,Arial,sans-serif;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:${color};padding:28px 24px;text-align:center;">${header}</td>
            </tr>
            <tr>
              <td style="padding:32px 24px;color:#111318;font-size:15px;line-height:1.6;">${bodyHtml}</td>
            </tr>
            ${
              unsubscribeUrl
                ? `<tr><td style="padding:16px 24px;text-align:center;font-size:12px;color:#8a8d94;border-top:1px solid #ececec;">
                     <a href="${escapeHtml(unsubscribeUrl)}" style="color:#8a8d94;">Unsubscribe from offers</a>
                   </td></tr>`
                : ""
            }
          </table>
          <p style="margin:16px 0 0;font-size:12px;color:#a7a9ae;">${name}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** A paragraph in the body's plain style — the one block every template reaches for. */
export function emailParagraph(text: string): string {
  return `<p style="margin:0 0 16px;">${escapeHtml(text)}</p>`;
}
