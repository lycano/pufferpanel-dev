import { randomBytes } from 'node:crypto'
import { test, expect, createUser, deleteStaleUsers, deleteUser, expectToast, field, grantScopes, scopeToggle } from './fixtures.js'
import { login } from './env.js'

// Section 5: users. One e2e user is created, edited, given permissions, logs in itself and is deleted again.

const stamp = Date.now()
const user = { name: `e2e-user-${stamp}`, email: `e2e-user-${stamp}@example.com`, password: randomBytes(12).toString('base64url') }
const edited = { name: `${user.name}-ed`, email: `e2e-user-${stamp}-ed@example.com` }
let userUrl

// what a non-admin needs to see and change user permissions (incl. their own)
const PERMISSION_EDITOR = ['Login', 'View a list of all users', 'View user information', 'View user permissions', 'Edit user permissions']

test.describe.serial('user lifecycle', () => {
  test.beforeAll(({ browser }) => deleteStaleUsers(browser, 'e2e-user-'))

  test('create: validation, then create', async ({ page }) => {
    await page.goto('/users')
    await page.locator('.createLink').click()
    await expect(page).toHaveURL(/\/users\/new$/)
    const create = page.getByRole('button', { name: 'Create User' })

    // too short a name and a broken email show their messages on blur and keep Create disabled
    await field(page, 'Username').fill('e2e')
    await field(page, 'Email').fill('e2e-no-email')
    await field(page, 'Password').fill(user.password)
    await field(page, 'Username').focus()
    await expect(page.getByText('Username must be at least 5 characters')).toBeVisible()
    await expect(page.getByText('Not a valid email')).toBeVisible()
    await expect(create).toBeDisabled()

    await field(page, 'Username').fill(user.name)
    await field(page, 'Email').fill(user.email)
    await field(page, 'Password').focus()
    await expect(page.getByText('Username must be at least 5 characters')).toBeHidden()
    await expect(page.getByText('Not a valid email')).toBeHidden()
    await expect(create).toBeEnabled()
    userUrl = await createUser(page, user)
  })

  test('details: rename, new email, reload', async ({ page }) => {
    await page.goto(userUrl)
    await expect(field(page, 'Username')).toHaveValue(user.name)
    await field(page, 'Username').fill(edited.name)
    await field(page, 'Email').fill(edited.email)
    await page.getByRole('button', { name: 'Update User Details' }).click()
    await expectToast(page, 'success', 'Updated User')
    await page.goto('/users')
    await expect(page.locator('.userlist .list-item', { hasText: edited.email })).toContainText(edited.name)
    await page.goto(userUrl)
    await expect(field(page, 'Username')).toHaveValue(edited.name)
    await expect(field(page, 'Email')).toHaveValue(edited.email)
  })

  test('permissions: set, save, reload', async ({ page }) => {
    await grantScopes(page, userUrl, PERMISSION_EDITOR)
  })

  // the user logs in itself: with "Edit user permissions" it can change permissions it has, not admin
  test('as the user: may edit its own permissions, not admin', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined })
    const page = await context.newPage()
    try {
      expect(await login(page, { email: edited.email, password: user.password })).toBe(true)
      await page.goto(userUrl)
      await expect(scopeToggle(page, 'Edit user permissions').locator('input')).toBeEnabled()
      await expect(scopeToggle(page, 'Admin').locator('input')).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Update User Permissions' })).toBeVisible()
    } finally {
      await context.close()
    }
  })

  test('delete', async ({ page }) => {
    await deleteUser(page, userUrl, edited.email)
  })
})
