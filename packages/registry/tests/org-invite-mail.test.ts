// The team-invite email renders an accept LINK (not a code) and reuses the
// shared Resend transport, without changing the login-code email.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sendOrgInviteEmail, sendLoginCodeEmail } from '../src/auth/magic-link-mail.js';

describe('org-invite email', () => {
  const prevKey = process.env.RESEND_API_KEY;
  before(() => {
    process.env.RESEND_API_KEY = 'test-key';
  });
  after(() => {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
  });

  const acceptUrl = 'https://skillet.md/settings/teams/accept?org=acme&invite=inv-123';

  it('renders the team, role, and accept link in html + text', async () => {
    let body: { subject: string; html: string; text: string; to: string[] } | null = null;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as typeof body;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const res = await sendOrgInviteEmail(
      { to: 'invitee@example.com', orgName: 'Acme Corp', inviterName: 'taylor', role: 'admin', acceptUrl },
      { fetchImpl },
    );
    assert.equal(res.ok, true);
    assert.ok(body, 'the Resend request body was captured');
    assert.deepEqual(body!.to, ['invitee@example.com']);
    assert.match(body!.subject, /Acme Corp/);
    // html escapes `&` in the query string; text carries the raw URL.
    assert.ok(
      body!.html.includes(acceptUrl.replace(/&/g, '&amp;')),
      'html carries the (escaped) accept link',
    );
    assert.ok(body!.text.includes(acceptUrl), 'text carries the accept link');
    assert.match(body!.html, /admin/);
    assert.match(body!.text, /admin/);
    assert.ok(body!.html.includes('taylor'), 'html names the inviter');
  });

  it('returns missing_resend_api_key when the key is unset', async () => {
    delete process.env.RESEND_API_KEY;
    const res = await sendOrgInviteEmail({
      to: 'invitee@example.com',
      orgName: 'Acme',
      inviterName: null,
      role: 'member',
      acceptUrl,
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'missing_resend_api_key');
    process.env.RESEND_API_KEY = 'test-key';
  });

  it('leaves the login-code email unchanged (code, no link)', async () => {
    let body: { subject: string; html: string; text: string } | null = null;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as typeof body;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const res = await sendLoginCodeEmail({ to: 'user@example.com', code: '482913' }, { fetchImpl });
    assert.equal(res.ok, true);
    assert.ok(body!.html.includes('482913'), 'html shows the code');
    assert.ok(!/https?:\/\//.test(body!.html), 'no URL in the login-code html');
    assert.match(body!.subject, /code/i);
  });
});
