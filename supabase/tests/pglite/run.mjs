// Offline SQL test runner: PGlite (Postgres in WASM) + the live schema snapshot + any newer migrations.
// Usage: npm run test:sql
import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { seed } from './fixtures.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', '..', 'migrations')

const readMigration = (filename) => readFile(join(migrationsDir, filename), 'utf8')

const db = new PGlite()
await db.exec(await readFile(join(here, 'platform-shim.sql'), 'utf8'))

// live-schema.sql (from `npm run test:sql:dump`) already holds every migration up to its `migrations-through`
// version; only newer migrations (the ones about to be pushed) are applied on top.
const live = await readFile(join(here, 'live-schema.sql'), 'utf8')
const through = live.match(/^-- migrations-through: (\d+)$/m)?.[1]
if (!through) {
  console.error('live-schema.sql has no migrations-through line; rerun npm run test:sql:dump')
  process.exit(1)
}
await db.exec(live)

const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql') && f.split('_')[0] > through).sort()
let applied = 0
for (const file of files) {
  try {
    await db.exec(await readMigration(file))
    applied++
  } catch (e) {
    console.error(`MIGRATION FAILED ${file}: ${e.message}`)
    process.exit(1)
  }
}
console.log(`live schema through ${through}, applied ${applied} newer migration(s)`)

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
