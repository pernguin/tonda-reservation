// Offline SQL test runner: PGlite (Postgres in WASM) + stub schema + the real migrations.
// Usage: npm run test:sql
import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { seed } from './fixtures.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', '..', 'migrations')

// filename -> reason. Migrations that cannot run in PGlite.
const SKIP = {}

// { file, find, replace, reason }: applied to the SQL text before exec.
const REWRITE = [
  {
    file: '20260914170100_server_side_assignment.sql',
    find: 'create extension if not exists pg_cron;',
    replace: '',
    reason: 'pg_cron is not available in PGlite; the `cron` schema stub provides what the migration calls',
  },
]

const readMigration = (filename) => readFile(join(migrationsDir, filename), 'utf8')

const db = new PGlite()
await db.exec(await readFile(join(here, 'stub-schema.sql'), 'utf8'))

const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
let applied = 0
let skipped = 0
for (const file of files) {
  if (SKIP[file]) {
    skipped++
    continue
  }
  let sql = await readMigration(file)
  for (const r of REWRITE.filter((x) => x.file === file)) {
    if (!sql.includes(r.find)) {
      console.error(`REWRITE target not found in ${file}: ${r.find}`)
      process.exit(1)
    }
    sql = sql.split(r.find).join(r.replace)
  }
  try {
    await db.exec(sql)
    applied++
  } catch (e) {
    console.error(`MIGRATION FAILED ${file}: ${e.message}`)
    process.exit(1)
  }
}
console.log(`applied ${applied}, skipped ${skipped}`)

const q = async (sql, params) => (await db.query(sql, params)).rows

const expectError = async (sql, params, pattern) => {
  await db.exec('savepoint expect_error')
  let err = null
  try {
    await db.query(sql, params)
  } catch (e) {
    err = e
  }
  await db.exec('rollback to savepoint expect_error')
  await db.exec('release savepoint expect_error')
  assert.ok(err, `expected an error matching ${pattern}, but the statement succeeded`)
  assert.match(err.message, pattern)
}

const ctx = { db, q, expectError, readMigration }

const testFiles = (await readdir(here)).filter((f) => f.endsWith('.test.mjs')).sort()
if (testFiles.length === 0) {
  console.error('no test files found')
  process.exit(1)
}

let failed = 0
for (const file of testFiles) {
  const name = file.replace(/\.test\.mjs$/, '')
  try {
    await db.exec('begin')
    await seed(db)
    const mod = await import(pathToFileURL(join(here, file)).href)
    await mod.default(ctx)
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}: ${e.message}`)
  } finally {
    await db.exec('rollback')
  }
}
process.exit(failed > 0 ? 1 : 0)
