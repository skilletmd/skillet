// Hermetic + opt-in MySQL proofs that free-text columns are wider than VARCHAR(191).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, it } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PrismaClient } from '@prisma/client'
import {
  ensureMysqlMigrated,
  freshMysqlPrisma,
  mysqlTestsEnabled,
} from './mysql-test-env.js'

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(here, '../prisma/schema.prisma')
const widenMigrationPath = join(
  here,
  '../prisma/migrations/20260719180000_widen_free_text_columns/migration.sql',
)

/** Fields that must leave VARCHAR(191) — Text / LongText / VarChar(512). */
const WIDENED_SCHEMA_MARKERS: Array<{ model: string; field: string; db: string }> = [
  { model: 'skills', field: 'description', db: '@db.Text' },
  { model: 'skills', field: 'deprecation_message', db: '@db.Text' },
  { model: 'skills', field: 'source_url', db: '@db.Text' },
  { model: 'skills', field: 'source_repo', db: '@db.VarChar(512)' },
  { model: 'kits', field: 'description', db: '@db.Text' },
  { model: 'kits', field: 'name', db: '@db.Text' },
  { model: 'authors', field: 'name', db: '@db.Text' },
  { model: 'skill_reports', field: 'admin_notes', db: '@db.Text' },
  { model: 'skill_proposals', field: 'decision_note', db: '@db.Text' },
  { model: 'skill_moderation_actions', field: 'public_reason', db: '@db.Text' },
  { model: 'mirror_review_queue', field: 'screen_notes', db: '@db.Text' },
  { model: 'connected_repos', field: 'token_enc', db: '@db.LongText' },
  { model: 'user_github_tokens', field: 'token_enc', db: '@db.LongText' },
  { model: 'mcp_links', field: 'token_secret_enc', db: '@db.LongText' },
  { model: 'users', field: 'author_public_key', db: '@db.LongText' },
  { model: 'skill_mirrors', field: 'source_repo', db: '@db.VarChar(512)' },
  { model: 'author_keys', field: 'label', db: '@db.VarChar(512)' },
]

/** Composite PK path columns must stay off unbounded TEXT (KTD5). */
const PATH_PK_FIELDS = ['proposal_files.path', 'skill_version_files.path']

describe('free-text column width', () => {
  it('annotates free-text fields in schema.prisma', () => {
    const schema = readFileSync(schemaPath, 'utf8')
    for (const { model, field, db } of WIDENED_SCHEMA_MARKERS) {
      const modelBlock = schema.match(new RegExp(`model\\s+${model}\\s*\\{([\\s\\S]*?)\\n\\}`))
      assert.ok(modelBlock, `missing model ${model}`)
      assert.match(
        modelBlock[1]!,
        new RegExp(`${field}\\s+String\\??[^\\n]*${db.replace(/[().]/g, '\\$&')}`),
        `${model}.${field} should carry ${db}`,
      )
    }
  })

  it('does not widen composite PK path columns to Text', () => {
    const schema = readFileSync(schemaPath, 'utf8')
    for (const ref of PATH_PK_FIELDS) {
      const [model, field] = ref.split('.') as [string, string]
      const modelBlock = schema.match(new RegExp(`model\\s+${model}\\s*\\{([\\s\\S]*?)\\n\\}`))
      assert.ok(modelBlock, `missing model ${model}`)
      const line = modelBlock[1]!
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith(`${field} `))
      assert.ok(line, `missing ${ref}`)
      assert.doesNotMatch(line, /@db\.(Text|LongText)/, `${ref} must not be Text/LongText`)
    }
  })

  it('ships a widen migration without TEXT/BLOB defaults', () => {
    const sql = readFileSync(widenMigrationPath, 'utf8')
    assert.match(sql, /MODIFY `description` TEXT NULL/)
    assert.match(sql, /MODIFY `token_enc` LONGTEXT/)
    assert.match(sql, /MODIFY `source_repo` VARCHAR\(512\)/)
    assert.doesNotMatch(sql, /(?:LONGTEXT|BLOB|TEXT)[^\n]*DEFAULT/)
  })

  const hasDatabaseUrl = mysqlTestsEnabled()
  describe('against MySQL', { skip: !hasDatabaseUrl }, () => {
    let prisma: PrismaClient | undefined

    before(async () => {
      await ensureMysqlMigrated()
      prisma = await freshMysqlPrisma()
    })

    after(async () => {
      await prisma?.$disconnect()
    })

    it('INFORMATION_SCHEMA shows text/longtext/varchar(512) for widened columns', async () => {
      assert.ok(prisma)
      const rows = await prisma.$queryRawUnsafe<
        Array<{
          TABLE_NAME: string
          COLUMN_NAME: string
          DATA_TYPE: string
          CHARACTER_MAXIMUM_LENGTH: number | null
        }>
      >(
        `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND (
             (TABLE_NAME = 'skills' AND COLUMN_NAME IN ('description','source_repo'))
             OR (TABLE_NAME = 'user_github_tokens' AND COLUMN_NAME = 'token_enc')
             OR (TABLE_NAME = 'skill_mirrors' AND COLUMN_NAME = 'source_repo')
           )`,
      )
      const byKey = new Map(rows.map((r) => [`${r.TABLE_NAME}.${r.COLUMN_NAME}`, r]))
      assert.equal(byKey.get('skills.description')?.DATA_TYPE, 'text')
      assert.equal(byKey.get('user_github_tokens.token_enc')?.DATA_TYPE, 'longtext')
      const repo = byKey.get('skill_mirrors.source_repo')
      assert.ok(repo)
      assert.equal(repo.DATA_TYPE, 'varchar')
      assert.equal(Number(repo.CHARACTER_MAXIMUM_LENGTH), 512)
      assert.equal(byKey.get('skills.source_repo')?.DATA_TYPE, 'varchar')
      assert.equal(Number(byKey.get('skills.source_repo')?.CHARACTER_MAXIMUM_LENGTH), 512)
    })

    it('round-trips a skills.description longer than 191 chars', async () => {
      assert.ok(prisma)
      const longDescription = 'x'.repeat(300)
      const authorId = `ft-author-${Date.now()}`
      const skillId = `ft-skill-${Date.now()}`

      await prisma.authors.create({
        data: { id: authorId, name: 'Free Text Author' },
      })
      await prisma.skills.create({
        data: {
          id: skillId,
          author_id: authorId,
          slug: `ft-slug-${Date.now()}`,
          description: longDescription,
        },
      })

      const found = await prisma.skills.findUnique({ where: { id: skillId } })
      assert.ok(found)
      assert.equal(found.description?.length, 300)
      assert.equal(found.description, longDescription)
    })
  })
})
