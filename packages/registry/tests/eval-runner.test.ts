import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runPublishEval, evalStatusFromMetadataJson } from '../src/eval-runner.js';
import { EVAL_SMOKE_PATH } from '@skillet/protocol';

describe('registry eval runner', () => {
  it('runPublishEval returns passed for a matching smoke fixture', () => {
    const bundle = new Map<string, Uint8Array>([
      [
        'SKILL.md',
        Buffer.from(`---
name: deploy
description: Deploy checklist.
---
# Deploy

Use this deploy checklist before production release.
`),
      ],
      [
        EVAL_SMOKE_PATH,
        Buffer.from(
          JSON.stringify({
            version: 1,
            cases: [
              {
                id: 'deploy',
                prompt: 'How do I deploy?',
                expect_in_skill: ['deploy', 'checklist'],
              },
            ],
          }),
        ),
      ],
    ]);
    assert.equal(runPublishEval(bundle), 'passed');
  });

  it('evalStatusFromMetadataJson reads eval field', () => {
    assert.equal(
      evalStatusFromMetadataJson(JSON.stringify({ eval: 'passed' })),
      'passed',
    );
    assert.equal(evalStatusFromMetadataJson('{}'), 'none');
  });
});
