import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, readlinkSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const TESTS = path.dirname(fileURLToPath(import.meta.url))
export const RESULTS = path.join(TESTS, 'test-results')
export const CONSOLE_DIR = path.join(RESULTS, 'console')
export const AUTH_STATE = path.join(RESULTS, '.auth.json')
// the Vite dev server: the frontend from source, Vue's development build (shows the errors production only logs)
export const PANEL = process.env.PP_URL || 'http://localhost:5173'

// one test admin for every worktree; the password is generated once and kept outside the repo
const USER_FILE = path.join(homedir(), '.config', 'pufferpanel-dev', 'e2e-user.json')

export function testUser() {
  if (!existsSync(USER_FILE)) {
    mkdirSync(path.dirname(USER_FILE), { recursive: true })
    // the panel wants usernames of 5 to 100 characters
    const user = { name: 'e2etest', email: 'e2etest@example.com', password: randomBytes(18).toString('base64url') }
    writeFileSync(USER_FILE, JSON.stringify(user, null, 2) + '\n', { mode: 0o600 })
  }
  return JSON.parse(readFileSync(USER_FILE, 'utf8'))
}

// the out/ folder of the panel that runs right now (each worktree has its own database there)
export function runningPanelDir() {
  for (const pid of readdirSync('/proc').filter(e => /^\d+$/.test(e))) {
    try {
      const args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
      if (args.at(-1) !== 'runService') continue
      const cwd = readlinkSync(`/proc/${pid}/cwd`)
      if (path.basename(cwd) === 'out') return cwd
    } catch {
      // process gone or not ours
    }
  }
  return null
}

// the login form on the current page: email, Enter, then the password field appears, Enter
export async function submitLogin(page, user) {
  await page.locator('input[name="email"]').fill(user.email)
  await page.keyboard.press('Enter')
  await page.locator('input[name="password"]:visible').fill(user.password)
  await page.keyboard.press('Enter')
}

// true when the panel lands on the server list
export async function login(page, user) {
  await page.goto(`${PANEL}/auth/login`)
  await submitLogin(page, user)
  return page.waitForURL(/\/servers/, { timeout: 10_000 }).then(() => true, () => false)
}
