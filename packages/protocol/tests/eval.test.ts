import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EvalError,
  EVAL_SMOKE_PATH,
  parseEvalFixture,
  runBasicEval,
} from '../src/eval.js';

function bundleWith(
  skillBody: string,
  evalJson?: string,
): Map<string, Uint8Array> {
  const bundle = new Map<string, Uint8Array>([
    ['SKILL.md', Buffer.from(skillBody, 'utf8')],
  ]);
  if (evalJson !== undefined) {
    bundle.set(EVAL_SMOKE_PATH, Buffer.from(evalJson, 'utf8'));
  }
  return bundle;
}

describe('parseEvalFixture', () => {
  it('accepts a minimal valid fixture', () => {
    const fixture = parseEvalFixture({
      version: 1,
      cases: [
        {
          id: 'deploy-smoke',
          prompt: 'How do I deploy?',
          expect_in_skill: ['deploy', 'checklist'],
        },
      ],
    });
    assert.equal(fixture.cases.length, 1);
    assert.deepEqual(fixture.cases[0]!.expect_in_skill, ['deploy', 'checklist']);
  });

  it('rejects empty cases', () => {
    assert.throws(
      () => parseEvalFixture({ version: 1, cases: [] }),
      EvalError,
    );
  });
});

describe('runBasicEval', () => {
  it('returns none when no eval fixture is bundled', () => {
    const result = runBasicEval(
      bundleWith(`---
name: x
description: y
---
Deploy checklist for production.
`),
    );
    assert.equal(result.status, 'none');
  });

  it('passes when all expect_in_skill terms are present', () => {
    const evalJson = JSON.stringify({
      version: 1,
      cases: [
        {
          id: 'deploy',
          prompt: 'How do I deploy to production?',
          expect_in_skill: ['deploy', 'checklist', 'production'],
        },
      ],
    });
    const result = runBasicEval(
      bundleWith(
        `---
name: deploy-ritual
description: Deploy checklist.
---
# Deploy ritual

Run the deploy checklist before production release.
`,
        evalJson,
      ),
    );
    assert.equal(result.status, 'passed');
  });

  it('fails when expected terms are missing', () => {
    const evalJson = JSON.stringify({
      version: 1,
      cases: [
        {
          id: 'rollback',
          prompt: 'How do I roll back?',
          expect_in_skill: ['rollback'],
        },
      ],
    });
    const result = runBasicEval(
      bundleWith(
        `---
name: deploy
description: Deploy only.
---
# Deploy
`,
        evalJson,
      ),
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.case_results?.[0]?.passed, false);
  });
});
