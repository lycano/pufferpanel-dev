import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { AUTH_STATE, CONSOLE_DIR, RESULTS, login, testUser, runningPanelDir } from './env.js'

// creates the test admin in the running instance's database (the air binary if there is one, else go run)
function addUser(user) {
  const out = runningPanelDir()
  if (!out) throw new Error('no running panel found; start one with start-puffer-upstream.py ... --watch')
  const air = path.join(out, '.air', 'pufferpanel')
  const [cmd, args] = existsSync(air) ? [air, []] : ['go', ['run', '../cmd']]
  console.log(`creating the test user ${user.email} in ${out}`)
  execFileSync(cmd, [...args, 'user', 'add', '--name', user.name, '--email', user.email,
    '--password', user.password, '--admin'], { cwd: out, stdio: 'inherit' })
}

export default async function globalSetup() {
  rmSync(CONSOLE_DIR, { recursive: true, force: true })
  mkdirSync(CONSOLE_DIR, { recursive: true })
  mkdirSync(RESULTS, { recursive: true })
  const user = testUser()
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    if (!(await login(page, user))) {
      addUser(user)
      if (!(await login(page, user))) throw new Error(`login as ${user.email} failed after creating the user`)
    }
    await page.context().storageState({ path: AUTH_STATE })
  } finally {
    await browser.close()
  }
}
