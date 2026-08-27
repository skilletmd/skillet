// U1: the pure query matcher behind universal search.
//
// The load-bearing assertions here are the single-token ones: they pin that a
// one-word query scores exactly what it scored before tokenization, which is
// the regression boundary for the whole change (R4).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildMatcher,
  matchScore,
  normalizeText,
  queryTokens,
  tokenClauses,
  SCORE_DESC,
  SCORE_EXACT,
  SCORE_NAME,
  SCORE_PREFIX,
} from '../src/lib/search-match.js'

/** Score a row the way the search functions do. */
function score(query: string, primary: (string | null)[], secondary: (string | null)[] = []) {
  return matchScore(buildMatcher(query), primary, secondary)
}

describe('normalizeText', () => {
  it('lowercases and collapses non-alphanumerics to single spaces', () => {
    assert.equal(normalizeText('Web-Design_Guidelines'), 'web design guidelines')
    assert.equal(normalizeText('  spaced   out  '), 'spaced out')
    assert.equal(normalizeText('a.b/c:d'), 'a b c d')
  })

  it('keeps non-ASCII letters and digits', () => {
    assert.equal(normalizeText('Café-Münster'), 'café münster')
    assert.equal(normalizeText('日本語 skill'), '日本語 skill')
    assert.equal(normalizeText('v2-migration'), 'v2 migration')
  })
})

describe('queryTokens', () => {
  it('splits a multi-word query', () => {
    assert.deepEqual(queryTokens('web design'), ['web', 'design'])
  })

  it('splits on hyphens and underscores', () => {
    assert.deepEqual(queryTokens('web-design'), ['web', 'design'])
    assert.deepEqual(queryTokens('web_design'), ['web', 'design'])
  })

  it('drops one-character tokens when longer ones survive', () => {
    assert.deepEqual(queryTokens('how do i review a PR'), ['how', 'do', 'review', 'pr'])
  })

  it('keeps short tokens when they are all there is', () => {
    assert.deepEqual(queryTokens('go ai'), ['go', 'ai'])
    assert.deepEqual(queryTokens('a'), ['a'])
  })

  it('caps at eight tokens', () => {
    const tokens = queryTokens('one two three four five six seven eight nine ten')
    assert.equal(tokens.length, 8)
    assert.deepEqual(tokens.at(-1), 'eight')
  })

  it('falls back to the raw trimmed string when nothing normalizes', () => {
    assert.deepEqual(queryTokens('!!!'), ['!!!'])
    assert.deepEqual(queryTokens('  ---  '), ['---'])
  })

  it('returns no tokens for an empty query', () => {
    assert.deepEqual(queryTokens(''), [])
    assert.deepEqual(queryTokens('   '), [])
  })
})

describe('matchScore — single token (unchanged from whole-string matching)', () => {
  it('scores an exact primary match at 1.0', () => {
    assert.equal(score('lint', ['lint']), SCORE_EXACT)
  })

  it('scores a primary prefix at 0.75', () => {
    assert.equal(score('lint', ['lint-tool']), SCORE_PREFIX)
  })

  it('scores a primary substring at 0.5', () => {
    assert.equal(score('lint', ['eslint-config']), SCORE_NAME)
  })

  it('scores a secondary-only match at 0.25', () => {
    assert.equal(score('lint', ['formatter'], ['runs the linter']), SCORE_DESC)
  })

  it('returns null when nothing matches', () => {
    assert.equal(score('lint', ['formatter'], ['formats code']), null)
  })
})

describe('matchScore — multi-word', () => {
  it('matches a hyphenated slug across the hyphen at the prefix tier', () => {
    assert.equal(score('web design', ['web-design-guidelines']), SCORE_PREFIX)
  })

  it('scores an exact match on a hyphenated slug at 1.0', () => {
    assert.equal(score('web design', ['web-design']), SCORE_EXACT)
    assert.equal(score('web-design', ['web design']), SCORE_EXACT)
  })

  it('scores a mid-field phrase match at 0.5', () => {
    assert.equal(score('web design', ['guidelines-for-web-design']), SCORE_NAME)
  })

  it('scores non-adjacent words in a primary field at 0.5', () => {
    assert.equal(score('web design', ['web-component-design']), SCORE_NAME)
  })

  it('ranks a partial match below a full one', () => {
    const full = score('web design', ['web-component-design'])
    const partial = score('web design', ['design-md'])
    assert.equal(partial, SCORE_DESC)
    assert.ok(full !== null && partial !== null && full > partial)
  })

  it('scores an all-token secondary match at 0.25', () => {
    assert.equal(score('web design', ['unrelated'], ['a web tool for design work']), SCORE_DESC)
  })

  it('returns null when no token matches', () => {
    assert.equal(score('web design', ['lint-tool'], ['formats code']), null)
  })
})

describe('matchScore — case and bounds', () => {
  it('is case-insensitive on the query', () => {
    assert.equal(score('Web Design', ['web-design-guidelines']), score('web design', ['web-design-guidelines']))
    assert.equal(score('LINT', ['lint-tool']), SCORE_PREFIX)
  })

  it('is case-insensitive on the fields', () => {
    assert.equal(score('web design', ['Web-Design-Guidelines']), SCORE_PREFIX)
  })

  it('ignores null and empty fields', () => {
    assert.equal(score('lint', [null, 'lint-tool']), SCORE_PREFIX)
    assert.equal(score('lint', [null], [null]), null)
  })

  it('keeps every score within [0, 1]', () => {
    const cases: [string, string[], string[]][] = [
      ['lint', ['lint'], []],
      ['web design', ['web-design-guidelines'], ['about web design']],
      ['how do i review a PR', ['pr-review'], ['reviews pull requests']],
      ['!!!', ['!!!'], []],
      ['go ai', ['go'], ['ai tooling']],
    ]
    for (const [q, primary, secondary] of cases) {
      const value = score(q, primary, secondary)
      assert.ok(value === null || (value > 0 && value <= 1), `${q} scored ${String(value)}`)
    }
  })

  it('matches a punctuation-only query against raw field text', () => {
    assert.equal(score('!!!', ['wow!!!']), SCORE_NAME)
    assert.equal(score('!!!', ['calm']), null)
  })
})

// A short token used to match anywhere, so `ai` hit "explain" and `c` hit
// "documentation". Short tokens now have to start a word.
describe('matchScore — short tokens match at a word boundary', () => {
  it('does not match a fragment inside a word', () => {
    assert.equal(score('ai', ['explain-code'], ['maintains a chain']), null)
    assert.equal(score('c', ['documentation-tool']), null)
    assert.equal(score('go', ['django-helper']), null)
    assert.equal(score('ui', ['build-guide']), null)
  })

  it('matches a short token that starts a word', () => {
    assert.equal(score('ai', ['ai-tools']), SCORE_PREFIX)
    assert.equal(score('ai', ['my-aider']), SCORE_NAME)
    assert.equal(score('go', ['golang-fmt']), SCORE_PREFIX)
  })

  it('finds a one-letter handle where the letter is its own word', () => {
    assert.equal(score('x', ['x-poster']), SCORE_PREFIX)
    assert.equal(score('x', ['twitter-x']), SCORE_NAME)
    assert.equal(score('x', ['post to x'], []), SCORE_NAME)
    assert.equal(score('x', ['linux-tools']), null, 'x inside a word is not a match')
  })

  it('reads c++ as the word c, not the letter c anywhere', () => {
    assert.equal(score('c++', ['c-programming']), SCORE_PREFIX)
    assert.equal(score('c++', ['unrelated'], ['a guide to c and rust']), SCORE_DESC)
    assert.equal(score('c++', ['documentation-basics']), null)
  })

  it('still matches long tokens anywhere in a word', () => {
    assert.equal(score('lint', ['eslint-config']), SCORE_NAME)
    assert.equal(score('web', ['webhooks']), SCORE_PREFIX)
  })
})

describe('tokenClauses', () => {
  it('builds one OR-across-columns clause per token', () => {
    assert.deepEqual(tokenClauses(buildMatcher('web design'), ['slug', 'description']), [
      { OR: [{ slug: { contains: 'web' } }, { description: { contains: 'web' } }] },
      { OR: [{ slug: { contains: 'design' } }, { description: { contains: 'design' } }] },
    ])
  })

  // Candidacy is capped and ordered by installs, so a permissive LIKE on a
  // short token would truncate the real matches out before scoring.
  it('asks SQL for a word boundary on a short token', () => {
    assert.deepEqual(tokenClauses(buildMatcher('ai'), ['slug']), [
      {
        OR: [
          { slug: { startsWith: 'ai' } },
          { slug: { contains: '-ai' } },
          { slug: { contains: ' ai' } },
        ],
      },
    ])
  })

  it('never emits an underscore boundary, which LIKE reads as a wildcard', () => {
    const emitted = JSON.stringify(tokenClauses(buildMatcher('c++'), ['slug', 'description']))
    assert.ok(!emitted.includes('_'), emitted)
  })

  it('matches a degenerate query literally, with no boundary variants', () => {
    assert.deepEqual(tokenClauses(buildMatcher('!!!'), ['slug']), [
      { OR: [{ slug: { contains: '!!!' } }] },
    ])
  })

  it('returns no clauses for no tokens', () => {
    assert.deepEqual(tokenClauses(buildMatcher(''), ['slug']), [])
  })
})
