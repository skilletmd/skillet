// The login-code email renders a CODE, not a link (U4).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sendLoginCodeEmail } from '../src/auth/magic-link-mail.js';

describe('login-code email', () => {
  const prevKey = process.env.RESEND_API_KEY;
  before(() => {
    process.env.RESEND_API_KEY = 'test-key';
  });
  after(() => {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
  });

  it('renders the code in html + text and carries no sign-in link', async () => {
    let body: { subject: string; html: string; text: string } | null = null;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as { subject: string; html: string; text: string };
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const res = await sendLoginCodeEmail({ to: 'user@example.com', code: '482913' }, { fetchImpl });
    assert.equal(res.ok, true);
    assert.ok(body, 'the Resend request body was captured');

    assert.ok(body!.html.includes('482913'), 'html shows the code');
    assert.ok(body!.text.includes('482913'), 'text shows the code');
    // No link anywhere — codes are the whole point.
    assert.ok(!/https?:\/\//.test(body!.html), 'no URL in the html');
    assert.ok(!/magic-link|\/verify|Sign in<\/a>/i.test(body!.html), 'no magic-link sign-in link');
    assert.match(body!.subject, /code/i);
  });
});

import { maskEmail } from '../src/auth/email-login-code.js';

describe('maskEmail (#471: no plaintext email in logs)', () => {
  it('keeps the first local-part char and the full domain', () => {
    assert.equal(maskEmail('alice@example.com'), 'a***@example.com');
    assert.equal(maskEmail('b@x.io'), 'b***@x.io');
  });
  it('never echoes the full local part', () => {
    assert.ok(!maskEmail('sensitive.name@corp.com').includes('sensitive.name'));
  });
  it('degrades safely on a malformed address', () => {
    assert.equal(maskEmail('notanemail'), '***');
    assert.equal(maskEmail('@nolocal.com'), '***');
  });
});
