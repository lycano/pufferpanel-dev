import { randomBytes } from 'node:crypto'
import { test, expect, createUser, deleteStaleUsers, deleteUser, expectToast, grantScopes, logout, openTab, pickDropdown } from './fixtures.js'
import { PANEL, login } from './env.js'

// Section 8: the account pages (/self). Everything that changes the account runs as a throwaway user e2e-acct-*, so
// a broken run can never lock the suite's own admin out. 2FA and OAuth2 are only visited (flows: to be done later).

const stamp = Date.now()
const acct = { name: `e2e-acct-${stamp}`, email: `e2e-acct-${stamp}@example.com`, password: randomBytes(12).toString('base64url') }
const newPassword = randomBytes(12).toString('base64url')
let acctUrl

// a fresh browser session logged in as the throwaway user
async function asAcct(browser, password, run) {
  const context = await browser.newContext({ storageState: undefined, baseURL: PANEL })
  const page = await context.newPage()
  try {
    expect(await login(page, { email: acct.email, password })).toBe(true)
    await run(page)
  } finally {
    await context.close()
  }
}

async function changePassword(page, from, to) {
  await page.goto('/self')
  await openTab(page, 'changepassword', 'Change Password')
  // the details tab next to it has a "Confirm Password" field as well
  const form = page.locator('.changepassword')
  const submit = form.getByRole('button', { name: 'Change Password' })
  await form.getByPlaceholder('Old Password', { exact: true }).fill(from)
  await form.getByPlaceholder('New Password', { exact: true }).fill(to)
  await form.getByPlaceholder('Confirm Password', { exact: true }).fill(`${to}-typo`)
  await expect(submit).toBeDisabled()
  await form.getByPlaceholder('Confirm Password', { exact: true }).fill(to)
  await expect(submit).toBeEnabled()
  await submit.click()
  await expectToast(page, 'success', 'Your password has been changed')
}

async function changeDetails(page, values, password) {
  await page.goto('/self')
  await openTab(page, 'account', 'Change Account Details')
  const details = page.locator('.accountdetails')
  await details.getByPlaceholder('Username', { exact: true }).fill(values.name)
  await details.getByPlaceholder('Email', { exact: true }).fill(values.email)
  await details.getByPlaceholder('Confirm Password', { exact: true }).fill(password)
  await details.getByRole('button', { name: 'Change Account Details' }).click()
  await expectToast(page, 'success', 'Your information has been changed')
}

test.describe.serial('own account', () => {
  test.beforeAll(({ browser }) => deleteStaleUsers(browser, 'e2e-acct-'))

  test('setup: throwaway user that may edit itself', async ({ page }) => {
    acctUrl = await createUser(page, acct)
    await grantScopes(page, acctUrl, ['Login', 'Edit own account', 'Manage own OAuth2 clients'])
  })

  test('password: change, log out, log in with the new one, change back', async ({ browser }) => {
    await asAcct(browser, acct.password, async page => {
      await changePassword(page, acct.password, newPassword)
      await logout(page)
      // the old password no longer works
      expect(await login(page, acct)).toBe(false)
      expect(await login(page, { ...acct, password: newPassword })).toBe(true)
      await changePassword(page, newPassword, acct.password)
      await logout(page)
    })
    await asAcct(browser, acct.password, async () => {})
  })

  test('details: rename, reload, rename back', async ({ browser }) => {
    const renamed = { name: `${acct.name}-ed`, email: `e2e-acct-${stamp}-ed@example.com` }
    await asAcct(browser, acct.password, async page => {
      await changeDetails(page, renamed, acct.password)
      await page.reload()
      await openTab(page, 'account', 'Change Account Details')
      await expect(page.locator('.accountdetails').getByPlaceholder('Username', { exact: true })).toHaveValue(renamed.name)
      await changeDetails(page, acct, acct.password)
    })
  })

  test('preferences: German, save, back to English', async ({ browser }) => {
    await asAcct(browser, acct.password, async page => {
      await page.goto('/self')
      await openTab(page, 'preferences', 'Preferences')
      await pickDropdown(page, 'Language', 'Deutsch (Deutschland)')
      await page.getByRole('button', { name: 'Save Preferences' }).click()
      // the toast may still be in the old language: savePreferences() does not wait for the locale to load
      await expectToast(page, 'success', /Deine Einstellungen wurden aktualisiert|Your preferences has been updated/)
      await expect(page.locator('.preferences h1')).toHaveText('Einstellungen')
      await pickDropdown(page, 'Sprache', 'English (United States)')
      await page.getByRole('button', { name: 'Einstellungen speichern' }).click()
      await expectToast(page, 'success', 'Your preferences has been updated')
      await expect(page.locator('.preferences h1')).toHaveText('Preferences')
    })
  })

  test('2FA and OAuth2: visit only', async ({ browser }) => {
    await asAcct(browser, acct.password, async page => {
      await page.goto('/self')
      await openTab(page, 'security', 'Two factor authentication')
      await expect(page.getByRole('button', { name: 'Set up authenticator app' })).toBeVisible()
      await openTab(page, 'oauth', 'OAuth2 Clients')
      await expect(page.locator('.oauth h1')).toHaveText('OAuth2 Clients')
    })
  })

  test('cleanup: delete the throwaway user', async ({ page }) => {
    await deleteUser(page, acctUrl, acct.email)
  })
})
