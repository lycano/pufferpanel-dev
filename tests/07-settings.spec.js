import { test, expect, expectToast, field, pickDropdown } from './fixtures.js'

// Section 7: panel settings. These are global, not e2e objects: every test puts back what it changed (finally).

const savePanel = page => page.getByRole('button', { name: 'Save Panel Settings' }).click()
const registration = page => page.locator('.settings .panel label.switch-wrapper', { has: page.locator('.label').getByText('Allow users to register themselves', { exact: true }) })
const emailProvider = page => page.locator('.settings .email .dropdown .multiselect-single-label')

// the page loads each setting with its own request; wait until the company name is there
async function openSettings(page) {
  await page.goto('/settings')
  await expect(field(page, 'Company Name')).not.toHaveValue('')
}

test('panel: company name and registration, save, reload, restore', async ({ page }) => {
  await openSettings(page)
  const name = await field(page, 'Company Name').inputValue()
  const registrationOn = await registration(page).locator('input').isChecked()
  try {
    await field(page, 'Company Name').fill(`e2e-${name}`)
    await registration(page).locator('.switch').click()
    await savePanel(page)
    await expectToast(page, 'success', 'Saved')
    await openSettings(page)
    await expect(field(page, 'Company Name')).toHaveValue(`e2e-${name}`)
    await expect(registration(page).locator('input')).toBeChecked({ checked: !registrationOn })
  } finally {
    await openSettings(page)
    await field(page, 'Company Name').fill(name)
    if (await registration(page).locator('input').isChecked() !== registrationOn) await registration(page).locator('.switch').click()
    await savePanel(page)
    await expectToast(page, 'success', 'Saved')
  }
  await openSettings(page)
  await expect(field(page, 'Company Name')).toHaveValue(name)
  await expect(registration(page).locator('input')).toBeChecked({ checked: registrationOn })
})

test('master URL: the auto-fill icon takes the current origin', async ({ page }) => {
  await openSettings(page)
  await field(page, 'Master URL').fill('')
  await page.locator('.master-url .icon-auto-fix').click()
  await expect(field(page, 'Master URL')).toHaveValue(new URL(page.url()).origin)
  // not saved: the dev panel keeps its own master URL
})

test('email: every provider shows its fields', async ({ page }) => {
  await openSettings(page)
  const fields = {
    SMTP: ['Sender Address', 'Host', 'Username', 'Password'],
    Mailgun: ['Domain', 'Sender Address', 'API Key'],
    Mailjet: ['Domain', 'Sender Address', 'API Key'],
    None: []
  }
  for (const [provider, labels] of Object.entries(fields)) {
    await pickDropdown(page, 'Email Provider', provider)
    await expect(page.locator('.settings .email input[placeholder]')).toHaveCount(labels.length)
    for (const label of labels) await expect(page.locator('.settings .email').getByPlaceholder(label, { exact: true })).toBeVisible()
  }
})

// only on a panel without mail setup: the dev-only Debug provider, a test mail, then back to None
test('email: debug provider, test mail, back to none', async ({ page }) => {
  await openSettings(page)
  // no element at all when the panel never had a provider
  const before = (await emailProvider(page).allTextContents()).join('').trim()
  test.skip(!['', 'None'].includes(before), `a mail provider is configured (${before}); not touching it`)
  try {
    await pickDropdown(page, 'Email Provider', 'Debug')
    await page.getByRole('button', { name: 'Save Email Settings' }).click()
    await expectToast(page, 'success', 'Saved')
    await page.getByRole('button', { name: 'Test Email' }).click()
    await expectToast(page, 'success', 'Test email sent')
  } finally {
    await openSettings(page)
    await pickDropdown(page, 'Email Provider', 'None')
    await page.getByRole('button', { name: 'Save Email Settings' }).click()
    await expectToast(page, 'success', 'Saved')
  }
})
