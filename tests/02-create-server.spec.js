import { test, expect, field, pickDropdown, saveState } from './fixtures.js'
import { testUser } from './env.js'

// Section 2: creating a server, step by step. The Minecraft server created here is used by 03-server and deleted there.

// step 1 (environment) up to the template list: name, the test user, node and environment
async function environmentStep(page, name) {
  await page.goto('/servers/new')
  await field(page, 'Server Name').fill(name)
  // the logged-in user is preselected; without any user the form says so (was a missing translation key)
  // #userselect is the search input of the multiselect; tags and options sit next to it
  const users = page.locator('.dropdown', { has: page.locator('#userselect') })
  const tag = users.locator('.multiselect-tag', { hasText: testUser().name })
  await expect(tag).toBeVisible()
  await tag.locator('.multiselect-tag-remove').click()
  await expect(page.getByText('At least one user is required')).toBeVisible()
  await page.locator('#userselect').fill(testUser().name)
  await page.locator('#userselect-dropdown .multiselect-option', { hasText: testUser().name }).first().click()
  await expect(page.getByText('At least one user is required')).toBeHidden()
  await pickDropdown(page, 'Node')
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.locator('.select-template')).toBeVisible()
}

async function selectTemplate(page, display) {
  await page.locator('.list-item.template', { has: page.locator('.title', { hasText: new RegExp(`^${display}$`) }) }).click()
  // only templates with a README show it first ("Use this template"); the others go straight to the settings
  const use = page.getByRole('button', { name: 'Use this template' })
  const settings = page.locator('.settings')
  await expect(use.or(settings).first()).toBeVisible()
  if (await use.isVisible()) await use.click()
  await expect(settings).toBeVisible()
}

test('back from the template list returns to the first step', async ({ page }) => {
  await environmentStep(page, `e2e-back-${Date.now()}`)
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(field(page, 'Server Name')).toBeVisible()
})

test('Minecraft: launcher groups, advanced settings, create', async ({ page }) => {
  const name = `e2e-mc-${Date.now()}`
  await environmentStep(page, name)
  await selectTemplate(page, 'Minecraft: Java Edition')

  // the launcher decides which group is shown (conditions on modlauncher; used to break the first render)
  const launcher = field(page, 'Mod/Plugin Launcher')
  for (const [option, groupField] of [['Paper', 'build'], ['MinecraftForge', 'Forge Version'], ['NeoForge', 'NeoForge Version']]) {
    await launcher.click()
    await page.locator('.suggestion', { hasText: new RegExp(`^${option}$`) }).click()
    await expect(field(page, groupField)).toBeVisible()
  }
  await launcher.click()
  await page.locator('.suggestion', { hasText: 'None/Vanilla' }).click()
  await expect(field(page, 'Forge Version')).toBeHidden()

  await page.getByText('EULA Agreement (true/false)').click()
  await page.getByText('Advanced Settings').click()

  await page.getByRole('button', { name: 'Create Server' }).click()
  await expect(page).toHaveURL(/\/servers\/view\/[0-9a-f]+/)
  const id = page.url().match(/\/servers\/view\/([0-9a-f]+)/)[1]
  saveState({ server: { id, name } })
})
