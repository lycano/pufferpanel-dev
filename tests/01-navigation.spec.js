import { test, expect, openTab, SERVER_TABS, TEMPLATE_TABS } from './fixtures.js'

// Section 1: every page and every tab once, without changing anything. Detail pages use the first entry of their list.

const SELF_TABS = [
  ['preferences', 'Preferences'], ['account', 'Change Account Details'], ['changepassword', 'Change Password'],
  ['security', 'Two factor authentication'], ['oauth', 'OAuth2 Clients']
]

// opens the first detail link of a list page; skips the test when the list is empty
async function openFirst(page, listPath, linkPart) {
  await page.goto(listPath)
  const link = page.locator(`a[href*="${linkPart}"]`).first()
  const found = await link.waitFor({ timeout: 5000 }).then(() => true, () => false)
  test.skip(!found, `no entry in ${listPath} yet`)
  await link.click()
  await expect(page).toHaveURL(new RegExp(linkPart))
}

for (const path of ['/servers', '/nodes', '/users', '/templates', '/settings']) {
  test(`list page ${path}`, async ({ page }) => {
    await page.goto(path)
    await expect(page.locator('main')).toBeVisible()
  })
}

for (const path of ['/servers/new', '/nodes/new', '/users/new']) {
  test(`create page ${path}`, async ({ page }) => {
    await page.goto(path)
    await expect(page.locator('main')).toBeVisible()
  })
}

test('server page: every tab, then away to another page', async ({ page }) => {
  await openFirst(page, '/servers', '/servers/view/')
  for (const [id, title] of SERVER_TABS) await openTab(page, id, title)
  // leaving a page with tabs used to break the next page (Tabs.vue)
  await page.locator('a[href="/nodes"]').first().click()
  await expect(page).toHaveURL(/\/nodes$/)
})

test('node page', async ({ page }) => {
  await openFirst(page, '/nodes', '/nodes/view/')
})

test('user page', async ({ page }) => {
  await openFirst(page, '/users', '/users/view/')
})

test('template page: every tab', async ({ page }) => {
  await openFirst(page, '/templates', '/templates/view/')
  for (const [id, title] of TEMPLATE_TABS) await openTab(page, id, title)
})

test('new template: every tab', async ({ page }) => {
  await page.goto('/templates/new')
  for (const [id, title] of TEMPLATE_TABS) await openTab(page, id, title)
})

test('account: every tab', async ({ page }) => {
  await page.goto('/self')
  for (const [id, title] of SELF_TABS) await openTab(page, id, title)
})

test('logged out pages', async ({ browser }) => {
  const context = await browser.newContext({ storageState: undefined })
  const page = await context.newPage()
  for (const path of ['/auth/login', '/auth/register']) {
    await page.goto(path)
    await expect(page.locator('input[name="email"], input[type="email"]').first()).toBeVisible()
  }
  await context.close()
})
