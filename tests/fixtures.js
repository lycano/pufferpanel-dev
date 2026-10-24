import { test as base, expect } from '@playwright/test'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { AUTH_STATE, CONSOLE_DIR, PANEL, RESULTS } from './env.js'

const STATE = path.join(RESULTS, 'state.json')

// Expected, not a bug (Chrome logs them in red):
// - 404 means "free": the template editor checks whether a name is taken, the file manager whether an archive name is
//   (makeArchiveName)
// - 500 on node features means "node unreachable"; NodeView shows exactly that (the 04 test node is unreachable)
// - 500 on a template repo's list means "repo cannot be fetched"; the list shows the error (the 06 test repos)
const EXPECTED = [
  { request: /\/api\/templates\/\d+\/[^/]+$/, status: 404 },
  { request: /\/api\/servers\/[0-9a-f]+\/file\/.+\.zip$/, status: 404 },
  { request: /\/api\/nodes\/\d+\/features$/, status: 500 },
  { request: /\/api\/templates\/\d+$/, status: 500 }
]

function expected(entry) {
  return EXPECTED.some(e => entry.status === e.status && e.request.test(entry.request || ''))
}

// short paths and no Vite cache-busting hashes, so the same problem is the same text in every run
function clean(text) {
  return String(text).replaceAll(PANEL, '').replace(/\?v=[0-9a-f]+/g, '').replace(/\?t=\d+/g, '')
}

// Chrome's "Failed to load resource" line: the URL and status, so EXPECTED applies to it like to the response itself
function loadFailure(msg) {
  const status = msg.text().match(/^Failed to load resource: .* status of (\d+)/)
  return status ? { request: msg.location().url, status: Number(status[1]) } : {}
}

function severity(entry) {
  if (entry.kind !== 'console') return 'error'
  if (entry.type === 'error') return 'error'
  // a key without English text shows the raw key in the UI; other locales fall back to English
  if (/\[intlify\] Not found '.*' key in 'en_US'/.test(entry.text)) return 'error'
  if (entry.type === 'warning' && /\[intlify\]/.test(entry.text)) return 'i18n'
  if (entry.type === 'warning') return 'warning'
  return null
}

// Every test gets the collector: console messages, page errors, failed requests and HTTP errors of every page it
// opens, written per section (spec file) to test-results/console/<section>.jsonl. It never fails a test.
export const test = base.extend({
  collector: [async ({ context }, use, testInfo) => {
    const section = path.basename(testInfo.file, '.spec.js')
    const file = path.join(CONSOLE_DIR, `${section}.jsonl`)
    const record = (page, entry) => {
      const full = { section, test: testInfo.title, url: clean(page.url()), ...entry }
      full.severity = severity(full)
      if (full.text) full.text = clean(full.text)
      if (full.request) full.request = clean(full.request)
      if (!full.severity || expected(full)) return
      appendFileSync(file, JSON.stringify(full) + '\n')
    }
    const watch = page => {
      page.on('console', msg => record(page, { kind: 'console', type: msg.type(), text: msg.text(), ...loadFailure(msg) }))
      page.on('pageerror', err => record(page, { kind: 'pageerror', text: err.stack || String(err) }))
      page.on('requestfailed', req => {
        // navigations away abort pending requests; that is not a problem of the page
        if (req.failure()?.errorText === 'net::ERR_ABORTED') return
        record(page, { kind: 'requestfailed', request: req.url(), text: req.failure()?.errorText })
      })
      page.on('response', res => {
        if (res.status() >= 400) {
          record(page, { kind: 'http', request: `${res.request().method()} ${res.url()}`, status: res.status(),
            text: `${res.status()} ${res.request().method()} ${res.url()}` })
        }
      })
    }
    context.pages().forEach(watch)
    context.on('page', watch)
    await use(null)
  }, { auto: true }]
})

export { expect }

// a <text-field> by its label (the label is also the placeholder of the input)
export function field(page, label) {
  return page.getByPlaceholder(label, { exact: true })
}

// App.vue's confirm dialog (events.emit('confirm', ...)): clicks the button with this text
// (button names start with the icon glyph, so no exact match; the dialog only has cancel and this one)
export async function confirmDialog(page, button) {
  const dialog = page.locator('.confirm-overlay')
  await dialog.getByRole('button', { name: button }).click()
  await expect(dialog).toBeHidden()
}

// --- users (05, 08): an admin creates a user on /users/new and deletes it on its page
export async function createUser(page, user) {
  await page.goto('/users/new')
  await field(page, 'Username').fill(user.name)
  await field(page, 'Email').fill(user.email)
  await field(page, 'Password').fill(user.password)
  await page.getByRole('button', { name: 'Create User' }).click()
  await expect(page).toHaveURL(/\/users\/view\/\d+$/)
  return page.url()
}

export async function deleteUser(page, userUrl, email) {
  await page.goto(userUrl)
  await page.getByRole('button', { name: 'Delete User' }).click()
  await confirmDialog(page, 'Delete User')
  await expectToast(page, 'success', 'User deleted successfully')
  await expect(page).toHaveURL(/\/users$/)
  await expect(page.locator('.userlist .list-item').first()).toBeVisible()
  await expect(page.locator('.userlist .list-item', { hasText: email })).toHaveCount(0)
}

// a failed earlier run leaves its users behind: deletes every user whose email starts with the prefix
export async function deleteStaleUsers(browser, emailPrefix) {
  const page = await browser.newPage({ storageState: AUTH_STATE, baseURL: PANEL })
  await page.goto('/users')
  await expect(page.locator('.userlist .list-item').first()).toBeVisible()
  const stale = await page.locator('.userlist .list-item a', { has: page.locator('.subline', { hasText: emailPrefix }) })
    .evaluateAll(as => as.map(a => [a.getAttribute('href'), a.querySelector('.subline').textContent]))
  for (const [href, email] of stale) await deleteUser(page, href, email)
  await page.close()
}

// a permission toggle on a user page by its label
export function scopeToggle(page, label) {
  return page.locator('.permissions label.switch-wrapper', { has: page.locator('.label').getByText(label, { exact: true }) })
}

// switches the given permissions on, saves, and checks them after a reload
export async function grantScopes(page, userUrl, labels) {
  await page.goto(userUrl)
  for (const label of labels) {
    const toggle = scopeToggle(page, label)
    if (!await toggle.locator('input').isChecked()) await toggle.locator('.switch').click()
    await expect(toggle.locator('input')).toBeChecked()
  }
  await page.getByRole('button', { name: 'Update User Permissions' }).click()
  await expectToast(page, 'success', 'Updated User')
  await page.goto(userUrl)
  for (const label of labels) await expect(scopeToggle(page, label).locator('input')).toBeChecked()
}

export async function logout(page) {
  await page.locator('nav').getByText('Logout', { exact: true }).click()
  await expect(page).toHaveURL(/\/auth\/login/)
}

// toasts stay a few seconds, so an earlier one can still be shown: look for the one with the expected text
export async function expectToast(page, kind, text) {
  await expect(page.locator(`.toast.${kind}`, { hasText: text })).toBeVisible()
}

// values a later section needs (e.g. the server created in 02), in test-results/state.json
export function saveState(values) {
  writeFileSync(STATE, JSON.stringify({ ...loadState(), ...values }, null, 2))
}

export function loadState() {
  return existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}
}

// the panel's <dropdown> (vueform multiselect) with this label; picks the option with the text, or the first one
export async function pickDropdown(page, label, option) {
  const dropdown = page.locator('.dropdown', { has: page.locator('label', { hasText: new RegExp(`^${label}$`) }) })
  await dropdown.locator('.multiselect').click()
  const options = dropdown.locator('.multiselect-option')
  await (option ? options.filter({ hasText: option }).first() : options.first()).click()
}

// [id, title] of the tabs of a server page and of the template editor (the server definition editor has the same
// ones without General)
export const SERVER_TABS = [
  ['console', 'Console'], ['stats', 'Statistics'], ['files', 'Files'], ['settings', 'Settings'],
  ['users', 'Users'], ['sftp', 'SFTP Information'], ['backups', 'Backup'], ['admin', 'Admin']
]
export const TEMPLATE_TABS = [
  ['general', 'General'], ['variables', 'Variables'], ['install', 'Install'], ['run', 'Run Configuration'],
  ['hooks', 'Hooks'], ['environment', 'Environment'], ['json', 'JSON']
]
// a tab of the panel's <tabs> component: the buttons only carry the title, the content is <div id="<id>" class="tab">
export async function openTab(page, id, title) {
  await page.locator('.tab-button', { has: page.locator('.title', { hasText: new RegExp(`^${title}$`) }) }).click()
  await expect(page.locator(`.tab#${id}`)).toHaveClass(/\bactive\b/)
}
