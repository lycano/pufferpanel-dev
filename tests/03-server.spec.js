import { test, expect, confirmDialog, expectToast, field, loadState, openTab, saveState, SERVER_TABS, TEMPLATE_TABS } from './fixtures.js'
import { testUser } from './env.js'

// Section 3: the server created in 02, tab by tab; the last test deletes it.
// Start/stop/install download Java and the server jar, so they only run with PP_SLOW=1.

const SLOW = !!process.env.PP_SLOW
const TAB_TITLES = Object.fromEntries(SERVER_TABS)

// the server page of the 02 server on one tab; skips when 02 has not created one (or this section deleted it)
async function openServer(page, tab) {
  const { server } = loadState()
  test.skip(!server, 'no e2e server; run 02-create-server first')
  await page.goto(`/servers/view/${server.id}`)
  await openTab(page, tab, TAB_TITLES[tab])
  return server
}

// --- files: grid view; every entry is <a class="file"> with the name in .name
const fileEntry = (page, name) => page.locator('.file-list .file', { has: page.locator('.name').getByText(name, { exact: true }) })

// the menu button and the selection toggle of an entry only show on hover
async function hoveredEntry(page, name) {
  await fileEntry(page, name).hover()
  return fileEntry(page, name)
}

async function fileAction(page, name, label) {
  await (await hoveredEntry(page, name)).locator('.button', { has: page.locator('.icon-menu') }).click()
  await page.locator('.context-menu .context-action a', { hasText: label }).click()
}

// "Create file" / "Create folder": the overlay has one text field and a button with the same title
async function createItem(page, title, name) {
  await page.locator(`.file-manager .controls .button[data-tooltip="${title}"]`).click()
  const overlay = page.locator('.overlay', { has: page.locator('.title', { hasText: title }) })
  await overlay.locator('input').fill(name)
  await overlay.getByRole('button', { name: title }).click()
}

test('console: send a command, history with arrow up', async ({ page }) => {
  await openServer(page, 'console')
  const command = field(page, 'Command')
  await command.fill('e2e-say hello')
  await command.press('Enter')
  await expect(command).toHaveValue('')
  await command.press('ArrowUp')
  await expect(command).toHaveValue('e2e-say hello')
  await command.press('ArrowDown')
  await expect(command).toHaveValue('')
})

test('files: folder, file, editor, archive, extract, delete', async ({ page }) => {
  const dir = `e2e-dir-${Date.now()}`
  const zip = `${dir}.zip`
  await openServer(page, 'files')
  const crumbs = page.locator('.file-manager .header h3')

  // creating a folder opens it
  await createItem(page, 'Create folder', dir)
  await expect(crumbs).toContainText(dir)

  // creating a file opens it in the editor; save closes the editor
  await createItem(page, 'Create file', 'e2e-file.txt')
  await expect(page.locator('#file-editor')).toBeVisible()
  await page.locator('#file-editor').click()
  await page.keyboard.type('e2e content')
  await page.locator('.overlay-header').getByRole('button', { name: 'Save' }).click()
  await expectToast(page, 'success', 'File saved')
  await expect(page.locator('#file-editor')).toBeHidden()

  // reopening shows the saved content
  await fileEntry(page, 'e2e-file.txt').click()
  await expect(page.locator('#file-editor .ace_content')).toContainText('e2e content')
  await page.locator('.overlay-header .button', { has: page.locator('.icon-close') }).click()
  await expect(page.locator('#file-editor')).toBeHidden()

  // back to the root, archive the folder, delete it, get it back by extracting
  await crumbs.locator('a').first().click()
  await expect(fileEntry(page, dir)).toBeVisible()
  await fileAction(page, dir, 'Archive')
  await expect(fileEntry(page, zip)).toBeVisible()
  await fileAction(page, dir, 'Delete')
  await confirmDialog(page, 'Delete')
  await expect(fileEntry(page, dir)).toBeHidden()
  await fileAction(page, zip, 'Extract')
  await expect(fileEntry(page, dir)).toBeVisible()
  await fileEntry(page, dir).click()
  await expect(fileEntry(page, 'e2e-file.txt')).toBeVisible()
  await crumbs.locator('a').first().click()

  // select both and delete them together
  for (const name of [dir, zip]) await (await hoveredEntry(page, name)).locator('.file-select').click()
  await expect(page.locator('.selection-count')).toHaveText(/2/)
  await page.locator('.file-manager .controls .button', { has: page.locator('.icon-remove') }).click()
  await confirmDialog(page, 'Delete')
  await expect(fileEntry(page, dir)).toBeHidden()
  await expect(fileEntry(page, zip)).toBeHidden()
})

test('settings: change the MOTD, save, reload', async ({ page }) => {
  const motd = `e2e motd ${Date.now()}`
  await openServer(page, 'settings')
  await field(page, 'MOTD message of the day').fill(motd)
  await page.getByRole('button', { name: 'Save Settings' }).click()
  await expectToast(page, 'success', 'Settings saved')
  await openServer(page, 'settings')
  await expect(field(page, 'MOTD message of the day')).toHaveValue(motd)
})

test('users: remove the test user, invite it again', async ({ page }) => {
  await openServer(page, 'users')
  const user = page.locator('.user', { has: page.locator('h3', { hasText: new RegExp(`^${testUser().name}$`) }) })
  await expect(user).toBeVisible()
  // entries are collapsed; the name opens one
  await user.locator('h3').click()
  await user.getByRole('button', { name: 'Delete User' }).click()
  await expect(user).toBeHidden()
  await field(page, 'Email').fill(testUser().email)
  await page.getByRole('button', { name: 'Invite user' }).click()
  await expectToast(page, 'success', 'User invited')
  await expect(user).toBeVisible()
})

test('backups: create, delete', async ({ page }) => {
  const name = `e2e-backup-${Date.now()}`
  await openServer(page, 'backups')
  await field(page, 'Name').fill(name)
  await page.getByRole('button', { name: 'Create backup' }).click()
  await expectToast(page, 'success', 'Backup started')
  const backup = page.locator('.backup', { hasText: name })
  // the backup runs in the background; the list shows it once it is done
  await expect(async () => {
    await openServer(page, 'backups')
    await expect(backup).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 30_000 })
  await backup.locator('.button', { has: page.locator('.icon-remove') }).click()
  await confirmDialog(page, 'Delete')
  await expectToast(page, 'success', 'Backup deleted successfully')
  await expect(backup).toBeHidden()
})

test('admin: server definition, every tab, save', async ({ page }) => {
  await openServer(page, 'admin')
  await page.getByRole('button', { name: 'Edit Server Definition' }).click()
  const overlay = page.locator('.overlay-backdrop', { has: page.locator('.server-definition') })
  for (const [id, title] of TEMPLATE_TABS.filter(([id]) => id !== 'general')) await openTab(page, id, title)
  await page.locator('.server-definition .actions').getByRole('button', { name: 'Save' }).click()
  await expectToast(page, 'success', 'Saved')
  await expect(overlay).toBeHidden()
})

test.describe('start, stop, install (PP_SLOW=1)', () => {
  test.skip(!SLOW, 'slow: downloads Java and the server jar; run with PP_SLOW=1')
  test.setTimeout(15 * 60_000)

  const status = page => page.locator('.server-header .status')

  // Controls.vue: start/stop/install as buttons, those that do not fit are only in the ⋮ menu
  async function control(page, action) {
    const direct = page.locator(`.server-controls > .${action}`)
    if (await direct.isVisible()) return direct.click()
    await page.locator('.server-controls > .menu').click()
    await page.locator(`.server-controls .menu.open .${action}`).click()
  }

  test('install, start, stop', async ({ page }) => {
    await openServer(page, 'console')
    await control(page, 'install')
    await expect(status(page)).toHaveClass(/\binstalling\b/, { timeout: 30_000 })
    await expect(status(page)).toHaveClass(/\boffline\b/, { timeout: 10 * 60_000 })
    await control(page, 'start')
    await expect(status(page)).toHaveClass(/\bonline\b/, { timeout: 60_000 })
    await expect(page.locator('.console')).toContainText('Done', { timeout: 3 * 60_000 })
    await control(page, 'stop')
    await expect(status(page)).toHaveClass(/\boffline\b/, { timeout: 60_000 })
  })
})

test('admin: delete the server', async ({ page }) => {
  const server = await openServer(page, 'admin')
  // not "Force Delete Server"; the name starts with the icon glyph
  await page.getByRole('button', { name: /^\W*Delete Server$/ }).click()
  await confirmDialog(page, 'Delete Server')
  await expectToast(page, 'success', 'Deleted Server')
  await expect(page).toHaveURL(/\/servers$/)
  await expect(page.locator(`a[href*="/servers/view/${server.id}"]`)).toHaveCount(0)
  saveState({ server: null })
})
