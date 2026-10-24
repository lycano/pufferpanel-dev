import { test, expect } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { runningPanelDir } from './env.js'

// Section 0: every key the code uses must have an English text (other locales fall back to en_US, a missing English
// key shows the raw key in the UI). Static, no browser: checks the worktree of the running panel. The lang files are
// not fixed by this suite; a failure here is the list to report.

const out = runningPanelDir()
const TREE = out && path.dirname(out)
const FRONTEND = TREE && path.join(TREE, 'client', 'frontend', 'src')

function sourceFiles(dir, extensions) {
  return readdirSync(dir, { recursive: true })
    .filter(f => extensions.includes(path.extname(f)) && !f.split(path.sep).includes('node_modules'))
    .map(f => readFileSync(path.join(dir, f), 'utf8'))
}

// en_US is one JSON file per namespace: lang/en_US/servers.json holds servers.*
function hasEnglish(key) {
  const [namespace, ...rest] = key.split('.')
  let node
  try {
    node = JSON.parse(readFileSync(path.join(FRONTEND, 'lang', 'en_US', `${namespace}.json`), 'utf8'))
  } catch {
    return false
  }
  for (const part of rest) {
    if (node === null || typeof node !== 'object' || !(part in node)) return false
    node = node[part]
  }
  return true
}

function missing(keys) {
  return [...new Set(keys)].filter(k => !hasEnglish(k)).sort()
}

test.beforeEach(() => {
  test.skip(!TREE, 'no running panel found')
})

// t('a.b') / $t('a.b') with a literal key; keys built at runtime (t(`x.${y}`), t('x.' + y)) cannot be checked here,
// those show up in the console report when a page uses them
test('frontend: every literal t() key has an English text', () => {
  const keys = sourceFiles(FRONTEND, ['.vue', '.js'])
    .flatMap(src => [...src.matchAll(/(?<![\w.])\$?t\(\s*['"]([\w-]+\.[\w.-]*\w)['"]/g)].map(m => m[1]))
  expect(missing(keys)).toEqual([])
})

// App.vue shows every API error as t('errors.' + code)
test('backend: every error code has an English text', () => {
  const codes = sourceFiles(TREE, ['.go'])
    .flatMap(src => [...src.matchAll(/CreateError\([^,]+,\s*"(\w+)"/g)].map(m => `errors.${m[1]}`))
  expect(missing(codes)).toEqual([])
})
