// Production magic-link delivery via Resend.

export interface MagicLinkMailResult {
  ok: boolean;
  error?: string;
}

const RESEND_API = 'https://api.resend.com/emails';

function magicLinkFromAddress(): string {
  return (
    process.env.MAGIC_LINK_FROM_EMAIL?.trim() ??
    process.env.SKILLET_MAGIC_LINK_FROM?.trim() ??
    'Skillet <login@skillet.md>'
  );
}

/**
 * Whether real email delivery is configured (a Resend API key is present). Gates
 * whether the route ATTEMPTS to send. Deliberately NOT keyed on NODE_ENV: a
 * self-host with a mail provider set must deliver sign-in / invite emails even if
 * it forgot NODE_ENV=production, or sign-in is silently dead. The dev-only
 * response fields (dev_code, dev_accept_url) are gated separately on dev auth.
 */
export function mailDeliveryConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/**
 * Generic Resend send. Both the login-code and the org-invite emails sit on top
 * of this so there is exactly one transport (one API key + from-address path).
 * Returns `missing_resend_api_key` (without sending) when the key is unset.
 */
export async function sendEmail(
  params: { to: string; subject: string; html: string; text: string },
  opts?: { fetchImpl?: typeof fetch },
): Promise<MagicLinkMailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: 'missing_resend_api_key' };
  }

  const fetchImpl = opts?.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(RESEND_API, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: magicLinkFromAddress(),
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    });
  } catch {
    return { ok: false, error: 'resend_request_failed' };
  }

  if (res.ok) return { ok: true };

  let detail = `resend_http_${res.status}`;
  try {
    const body = (await res.json()) as { message?: string };
    if (body.message) detail = body.message;
  } catch {
    // Keep status-based detail.
  }
  return { ok: false, error: detail };
}

// ── Shared branded shell ────────────────────────────────────────────────────

const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,'SF Mono','Cascadia Code',Menlo,Consolas,monospace";

// Skillet brand tokens, mirroring packages/web globals.css :root.
const PAPER = '#fafaf8'; // warm paper canvas
const SURFACE = '#ffffff';
const INK = '#1a1915'; // near-black text
const MUTED = '#646258';
const LINE = '#e6e4dd'; // hairline borders
const CHIP = '#f0ece1'; // soft card fill for the code
const ACCENT = '#2a2622'; // dark CTA

/**
 * Wraps body HTML in the branded shell: warm paper canvas, a centered white
 * card, the Skillet wordmark, and a muted footer. Both emails share it so they
 * read as one family.
 *
 * The header is a typographic wordmark, not the mascot image, on purpose: the
 * login-code email carries no URL by policy (U4), and Gmail/Outlook strip
 * remote and data-URI images by default, so text is the only mark that renders
 * identically everywhere.
 */
function renderEmail(p: { preheader: string; bodyHtml: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
</head>
<body style="margin:0;padding:0;background:${PAPER};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(p.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="440" cellpadding="0" cellspacing="0" border="0" style="width:440px;max-width:100%;">
          <tr>
            <td style="padding:0 4px 20px 4px;font-family:${SANS};font-size:15px;font-weight:700;letter-spacing:0.4px;color:${INK};">Skillet</td>
          </tr>
          <tr>
            <td style="background:${SURFACE};border:1px solid ${LINE};border-radius:16px;padding:32px;">
              ${p.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 4px 0 4px;font-family:${SANS};font-size:12px;line-height:1.5;color:${MUTED};">Skillet · skills worth running</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Email login code (OAuth-first passwordless fallback) ────────────────────

function loginCodeSubject(): string {
  return process.env.LOGIN_CODE_SUBJECT?.trim() ?? 'Your Skillet sign-in code';
}

function buildLoginCodeHtml(code: string): string {
  const safe = code.replace(/[^0-9]/g, '');
  const body = `<h1 style="margin:0 0 6px 0;font-family:${SANS};font-size:18px;font-weight:700;color:${INK};">Your sign-in code</h1>
  <p style="margin:0 0 20px 0;font-family:${SANS};font-size:14px;line-height:1.6;color:${MUTED};">Enter this on the sign-in page to finish signing in.</p>
  <div style="font-family:${MONO};font-size:34px;font-weight:700;letter-spacing:10px;text-indent:10px;color:${INK};background:${CHIP};border:1px solid ${LINE};border-radius:12px;padding:18px 0;text-align:center;">${safe}</div>
  <p style="margin:20px 0 0 0;font-family:${SANS};font-size:13px;line-height:1.6;color:${MUTED};">This code expires in 10 minutes. If you didn't request it, you can ignore this email.</p>`;
  return renderEmail({
    preheader: 'Your Skillet sign-in code. Expires in 10 minutes.',
    bodyHtml: body,
  });
}

function buildLoginCodeText(code: string): string {
  const safe = code.replace(/[^0-9]/g, '');
  return [
    'Your Skillet sign-in code:',
    '',
    safe,
    '',
    'Enter it on the sign-in page to finish signing in.',
    'This code expires in 10 minutes.',
    "If you didn't request it, you can ignore this email.",
    '',
    'Skillet · skills worth running',
  ].join('\n');
}

/** Sends a login code through Resend when `RESEND_API_KEY` is configured. */
export async function sendLoginCodeEmail(
  params: { to: string; code: string },
  opts?: { fetchImpl?: typeof fetch },
): Promise<MagicLinkMailResult> {
  return sendEmail(
    {
      to: params.to,
      subject: loginCodeSubject(),
      html: buildLoginCodeHtml(params.code),
      text: buildLoginCodeText(params.code),
    },
    opts,
  );
}

// ── Team (org) invite ───────────────────────────────────────────────────────

function orgInviteSubject(orgName: string): string {
  return `You're invited to ${orgName} on Skillet`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface OrgInviteMail {
  to: string;
  orgName: string;
  inviterName: string | null;
  role: string;
  acceptUrl: string;
}

function buildOrgInviteHtml(p: OrgInviteMail): string {
  const org = escapeHtml(p.orgName);
  const who = p.inviterName ? escapeHtml(p.inviterName) : 'Someone';
  const role = escapeHtml(p.role);
  const url = escapeHtml(p.acceptUrl);
  const body = `<h1 style="margin:0 0 6px 0;font-family:${SANS};font-size:18px;font-weight:700;color:${INK};">Join ${org} on Skillet</h1>
  <p style="margin:0 0 24px 0;font-family:${SANS};font-size:14px;line-height:1.6;color:${MUTED};">${who} invited you to <strong style="color:${INK};">${org}</strong> as ${role}.</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:10px;background:${ACCENT};">
    <a href="${url}" style="display:inline-block;font-family:${SANS};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:10px;">Accept invitation</a>
  </td></tr></table>
  <p style="margin:24px 0 0 0;font-family:${SANS};font-size:13px;line-height:1.6;color:${MUTED};">Or paste this link into your browser:<br><a href="${url}" style="color:${MUTED};">${url}</a></p>
  <p style="margin:12px 0 0 0;font-family:${SANS};font-size:13px;line-height:1.6;color:${MUTED};">If you didn't expect this, you can ignore it.</p>`;
  return renderEmail({
    preheader: `${p.inviterName ?? 'Someone'} invited you to ${p.orgName} on Skillet.`,
    bodyHtml: body,
  });
}

function buildOrgInviteText(p: OrgInviteMail): string {
  const who = p.inviterName ?? 'Someone';
  return [
    `${who} invited you to join ${p.orgName} on Skillet as ${p.role}.`,
    '',
    'Accept the invitation:',
    p.acceptUrl,
    '',
    'If you did not expect this, you can ignore it.',
  ].join('\n');
}

/** Sends a team-invite email with the accept link. */
export async function sendOrgInviteEmail(
  params: OrgInviteMail,
  opts?: { fetchImpl?: typeof fetch },
): Promise<MagicLinkMailResult> {
  return sendEmail(
    {
      to: params.to,
      subject: orgInviteSubject(params.orgName),
      html: buildOrgInviteHtml(params),
      text: buildOrgInviteText(params),
    },
    opts,
  );
}
