import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { looksNonEnglish } from '../src/lib/mirror-quality.js';

const md = (name: string, description: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n## What\n\nBody.\n`;

describe('looksNonEnglish', () => {
  it('flags CJK, kana, hangul, cyrillic and arabic', () => {
    for (const [n, d] of [
      ['human-writing', '让 AI 写的中文读起来像一个具体的人在说话'],
      ['toushi', 'スタンレー・ドラッケンミラーの投資哲学と戦略に基づいた投資アドバイス'],
      ['korean-report', '한국어 문서를 만들 때 사용하는 스킬입니다'],
      ['perevod', 'Навык для перевода технических документов'],
      ['takhtit', 'مهارة لتنظيم وتتبع تقدم المهام المعقدة'],
    ] as const) {
      assert.equal(looksNonEnglish(md(n, d)), true, `${n} should be flagged`);
    }
  });

  it('flags Latin-script languages that are clearly not English', () => {
    assert.equal(
      looksNonEnglish(md('comptable', 'Skills pour agents IA spécialisés dans la comptabilité française')),
      true,
    );
    assert.equal(
      looksNonEnglish(md('humanizer', 'Türkçe metinlerden yapay zekâ yazım imzalarını temizlemek için bir beceri')),
      true,
    );
  });

  // The expensive failure is the other direction: silently dropping a good
  // English skill. Accents alone must never be enough.
  it('does not flag English that happens to carry an accent', () => {
    for (const d of [
      'A naïve implementation of the résumé parser. Use when parsing a CV.',
      'Generate a café menu from a photo of the chalkboard.',
      'Deploy to Vercel with zero configuration.',
      'Review a pull request for correctness, tests and standards.',
    ]) {
      assert.equal(looksNonEnglish(md('x', d)), false, `should stay: ${d}`);
    }
  });

  it('treats an empty or missing description as English rather than guessing', () => {
    assert.equal(looksNonEnglish('---\nname: x\n---\n'), false);
    assert.equal(looksNonEnglish('no frontmatter at all'), false);
  });
});
