import { test, expect, confirmDialog, expectToast, field, openTab } from './fixtures.js'
import { AUTH_STATE, PANEL } from './env.js'

// Section 6: templates. Local templates e2e-tpl-* are created, edited, copied from the community repo and deleted;
// two repositories e2e-repo-* with unreachable URLs (.invalid TLD) are added and removed again.

const stamp = Date.now()
const TPL = `e2e-tpl-${stamp}`
const COPY = `e2e-tpl-copy-${stamp}`
const REPOS = [`e2e-repo-a-${stamp}`, `e2e-repo-b-${stamp}`]

const templateLink = (page, display) => page.locator('.templatelist .list-item', { has: page.locator('.title').getByText(display, { exact: true }) })
const repoHeader = (page, name) => page.locator('.template-repo-header', { has: page.locator('.name').getByText(name, { exact: true }) })

// General tab of the template editor: name (only on new templates), display name, type
async function fillGeneral(page, values) {
  for (const [label, value] of Object.entries(values)) {
    await field(page, label).fill(value)
    await field(page, label).blur()
  }
}

async function deleteTemplate(page, name) {
  await page.goto(`/templates/view/0/${name}`)
  await page.getByRole('button', { name: 'Delete Template' }).click()
  await confirmDialog(page, 'Delete Template')
  await expectToast(page, 'success', 'Template deleted')
  await expect(page).toHaveURL(/\/templates$/)
}

test.describe.serial('local templates', () => {
  // a failed earlier run leaves its templates behind (the delete test is skipped then)
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage({ storageState: AUTH_STATE, baseURL: PANEL })
    await page.goto('/templates')
    await expect(page.locator('.templatelist .list-item').first()).toBeVisible()
    const stale = await page.locator('a[href^="/templates/view/0/e2e-tpl-"]').evaluateAll(as => as.map(a => a.getAttribute('href').split('/').pop()))
    for (const name of stale) await deleteTemplate(page, name)
    await page.close()
  })

  test('new: required fields, save', async ({ page }) => {
    await page.goto('/templates/new')
    const save = page.getByRole('button', { name: /^\W*Save$/ })
    await expect(save).toBeDisabled()
    await fillGeneral(page, { Name: TPL, 'Display Name': `${TPL} display`, Type: 'e2e' })
    await openTab(page, 'run', 'Run Configuration')
    await field(page, 'Command').fill('echo e2e')
    await field(page, 'Command').blur()
    await expect(save).toBeEnabled()
    await save.click()
    await expectToast(page, 'success', 'Template saved')
    await expect(page).toHaveURL(new RegExp(`/templates/view/0/${TPL}(#\\w+)?$`))
  })

  test('new: a taken name is flagged, leaving asks to discard', async ({ page }) => {
    await page.goto('/templates/new')
    await field(page, 'Name').fill(TPL)
    // the name check is debounced (500 ms) and asks the API whether the name exists
    await expect(page.locator('.input-field-wrapper', { has: field(page, 'Name') }).locator('span.error')).toBeVisible()
    await page.locator('a[href="/templates"]').first().click()
    await confirmDialog(page, 'Discard')
    await expect(page).toHaveURL(/\/templates$/)
  })

  test('edit: display name, save, reload, JSON tab', async ({ page }) => {
    await page.goto(`/templates/view/0/${TPL}`)
    await expect(field(page, 'Name')).toBeDisabled()
    await fillGeneral(page, { 'Display Name': `${TPL} edited` })
    await page.getByRole('button', { name: 'Save Template' }).click()
    await expectToast(page, 'success', 'Template saved')
    // saved: leaving does not ask
    await page.goto('/templates')
    await expect(templateLink(page, `${TPL} edited`)).toBeVisible()
    await page.goto(`/templates/view/0/${TPL}`)
    await expect(field(page, 'Display Name')).toHaveValue(`${TPL} edited`)
    await openTab(page, 'json', 'JSON')
    await expect(page.locator('#template-json')).toContainText(`${TPL} edited`)
  })

  test('repo template: read only, local copy', async ({ page }) => {
    await page.goto('/templates/view/1/minecraft')
    await expect(page.getByText('You can only save changes made to local templates')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save Template' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Create local copy' }).click()
    await expect(page).toHaveURL(/\/templates\/new\?copy=true(#\w+)?$/)
    await expect(field(page, 'Display Name')).toHaveValue('Minecraft: Java Edition')
    await expect(field(page, 'Name')).toHaveValue('')
    await fillGeneral(page, { Name: COPY, 'Display Name': `${COPY} display` })
    await page.getByRole('button', { name: /^\W*Save$/ }).click()
    await expectToast(page, 'success', 'Template saved')
    await expect(page).toHaveURL(new RegExp(`/templates/view/0/${COPY}(#\\w+)?$`))
  })

  test('delete both', async ({ page }) => {
    await deleteTemplate(page, TPL)
    await deleteTemplate(page, COPY)
    await expect(page.locator('.templatelist .list-item').first()).toBeVisible()
    await expect(templateLink(page, `${TPL} edited`)).toHaveCount(0)
    await expect(templateLink(page, `${COPY} display`)).toHaveCount(0)
  })
})

test('repositories: add two, remove both', async ({ page }) => {
  await page.goto('/templates')
  for (const name of REPOS) {
    await page.locator('.repo.createLink').click()
    const overlay = page.locator('.overlay', { has: page.locator('.title', { hasText: 'Add Template Repository' }) })
    await overlay.getByPlaceholder('Repository Name', { exact: true }).fill(name)
    await overlay.getByPlaceholder('Repository URL', { exact: true }).fill(`https://${name}.invalid/templates.git`)
    await overlay.getByRole('button', { name: 'Add Template Repository' }).click()
    await expect(overlay).toBeHidden()
    await expect(repoHeader(page, name)).toBeVisible()
  }
  // both are there, the second did not replace the first
  for (const name of REPOS) await expect(repoHeader(page, name)).toBeVisible()
  for (const name of REPOS) {
    await repoHeader(page, name).locator('.remove').click()
    await confirmDialog(page, 'Delete Repository')
    await expect(repoHeader(page, name)).toHaveCount(0)
  }
})
