import assert from 'node:assert/strict';

export interface DevSession {
  user_id: string;
  session_token: string;
}

type ServerHandle = {
  app: {
    inject: (opts: {
      method: string;
      url: string;
      payload?: unknown;
      headers?: Record<string, string>;
    }) => Promise<{ statusCode: number; body: string; json: <T>() => T }>;
  };
};

export async function inviteAndAccept(
  h: ServerHandle,
  orgSlug: string,
  ownerSess: DevSession,
  inviteeSess: DevSession,
  payload: { handle: string; role?: string },
): Promise<void> {
  const inviteRes = await h.app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${orgSlug}/invites`,
    payload,
    headers: { authorization: `Bearer ${ownerSess.session_token}` },
  });
  assert.equal(inviteRes.statusCode, 200, inviteRes.body);
  const { invite_id } = inviteRes.json<{ invite_id: string }>();
  const acceptRes = await h.app.inject({
    method: 'POST',
    url: `/api/v1/orgs/${orgSlug}/invites/${invite_id}/accept`,
    headers: { authorization: `Bearer ${inviteeSess.session_token}` },
  });
  assert.equal(acceptRes.statusCode, 200, acceptRes.body);
}
