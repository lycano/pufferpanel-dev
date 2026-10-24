import { randomBytes } from 'node:crypto'
import { test, expect, deleteStaleUsers, expectToast, field, logout } from './fixtures.js'
import { PANEL, login, submitLogin, testUser } from './env.js'

// Section 9: login, redirects and self registration, all in logged-out sessions. The registered user e2e-reg-* is
// deleted again by the admin.

const stamp = Date.now()
const reg = { name: `e2e-reg-${stamp}`, email: `e2e-reg-${stamp}@example.com`, password: randomBytes(12).toString('base64url') }

// every test starts without a session
test.use({ storageState: { cookies: [], origins: [] } })

test.afterAll(({ browser }) => deleteStaleUsers(browser, 'e2e-reg-'))

const next = page => page.locator('.login').getByRole('button', { name: 'Next' })

test('login: invalid email keeps Next disabled', async ({ page }) => {
  await page.goto('/auth/login')
  await page.locator('input[name="email"]').fill('e2e-not-an-email')
  await expect(next(page)).toBeDisabled()
  await page.locator('input[name="email"]').blur()
  await expect(page.getByText('Not a valid email')).toBeVisible()
  await page.locator('input[name="email"]').fill(testUser().email)
  await expect(next(page)).toBeEnabled()
})

test('login: change email goes back to the first step', async ({ page }) => {
  await page.goto('/auth/login')
  await page.locator('input[name="email"]').fill(testUser().email)
  await next(page).click()
  await expect(page.locator('input[name="password"]:visible')).toBeVisible()
  await page.locator('.change-email').click()
  await expect(page.locator('input[name="password"]:visible')).toHaveCount(0)
  await expect(page.locator('input[name="email"]')).toBeEnabled()
})

// not via login(): that waits 10 s for the server list, the toast is gone by then
test('login: wrong password stays on the login page with an error', async ({ page }) => {
  await page.goto('/auth/login')
  await submitLogin(page, { ...testUser(), password: `${testUser().password}-wrong` })
  await expectToast(page, 'error', 'Invalid credentials')
  await expect(page).toHaveURL(/\/auth\/login/)
})

test('logged out: a protected page leads to login and back after it', async ({ page }) => {
  await page.goto('/templates')
  await expect(page).toHaveURL(/\/auth\/login/)
  await submitLogin(page, testUser())
  await expect(page).toHaveURL(/\/templates$/)
})

test('logged in: the login page redirects to the server list', async ({ page }) => {
  expect(await login(page, testUser())).toBe(true)
  await page.goto('/auth/login')
  await expect(page).toHaveURL(/\/servers$/)
})

test('register: validation, register, log out, log in', async ({ page }) => {
  await page.goto('/auth/register')
  const register = page.locator('.register').getByRole('button', { name: 'Register', exact: true })
  await field(page, 'Username').fill(reg.name)
  await field(page, 'Email').fill(reg.email)
  await field(page, 'Password').fill(reg.password)
  await field(page, 'Confirm Password').fill(`${reg.password}-typo`)
  await field(page, 'Confirm Password').blur()
  await expect(page.getByText('Passwords are not the same')).toBeVisible()
  await expect(register).toBeDisabled()
  await field(page, 'Confirm Password').fill(reg.password)
  await expect(register).toBeEnabled()
  await register.click()
  // registered users are logged in straight away
  await expect(page).toHaveURL(/\/servers$/)
  await logout(page)
  expect(await login(page, reg)).toBe(true)
})

// Known bug, open: the autofocused empty username shows its error on blur, the mousedown on the link blurs it, the
// error line pushes the link down and the click misses it (the same happens to a user's first click).
test('register: the login link', async ({ page }) => {
  test.fail(true, 'first click on "Or login here" is lost: blur validation of the empty autofocused field moves the link')
  await page.goto(`${PANEL}/auth/register`)
  await page.locator('.register').getByRole('button', { name: 'Or login here' }).click()
  await expect(page).toHaveURL(/\/auth\/login/)
})
