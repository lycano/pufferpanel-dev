import { test, expect, confirmDialog, expectToast, field } from './fixtures.js'

// Section 4: nodes. One node is created, edited and deleted in a single test (nothing else uses it). Its host is in the
// reserved .invalid TLD, so the panel can never reach it. The local node (id 0) has no editable settings.

const HOST = 'e2e-node.invalid'

const nodeLink = (page, name) => page.locator('.nodelist .list-item', { has: page.locator('.title').getByText(name, { exact: true }) })

// the deploy instructions: five steps with Next, then Close
async function walkDeployment(page, sftpPort) {
  const overlay = page.locator('.overlay', { has: page.locator('.title', { hasText: 'Deploy Node' }) })
  await expect(overlay).toBeVisible()
  for (let step = 1; step <= 4; step++) {
    await expect(overlay).toContainText(`Step ${step}`)
    // step 3 is the config.json for the new node
    if (step === 3) await expect(overlay).toContainText(`0.0.0.0:${sftpPort}`)
    await overlay.getByRole('button', { name: 'Next' }).click()
  }
  await expect(overlay).toContainText('ready to go')
  await overlay.getByRole('button', { name: 'Close' }).click()
  await expect(overlay).toBeHidden()
}

test('local node: no editable settings', async ({ page }) => {
  await page.goto('/nodes/view/0')
  await expect(page.locator('.nodeview .edit')).toContainText('The local node does not have any editable settings')
  await expect(page.getByRole('button', { name: 'Update Node' })).toHaveCount(0)
})

test('create, deploy steps, edit, delete', async ({ page }) => {
  const name = `e2e-node-${Date.now()}`
  await page.goto('/nodes')
  await page.locator('.createLink').click()
  await expect(page).toHaveURL(/\/nodes\/new$/)

  // Create stays disabled until name and host are there, and while the private address is on but empty
  const create = page.getByRole('button', { name: 'Create Node' })
  await expect(create).toBeDisabled()
  await field(page, 'Name').fill(name)
  await field(page, 'Public Host').fill(HOST)
  await expect(create).toBeEnabled()
  await page.locator('.private-toggle .switch').click()
  await expect(create).toBeDisabled()
  await page.locator('.private-toggle .switch').click()
  await expect(create).toBeEnabled()
  await create.click()
  await expectToast(page, 'success', 'Created Node')
  await expect(page).toHaveURL(/\/nodes\/view\/\d+\?created=true/)
  const url = page.url().replace(/\?.*$/, '')

  // after creating, the deploy instructions open by themselves; the node is not reachable
  await walkDeployment(page, '5657')
  await expect(page.locator('.features .unreachable')).toBeVisible()

  // edit: other name and port, separate private address; the values survive a reload
  await field(page, 'Name').fill(`${name}-edited`)
  await field(page, 'Public Port').fill('8081')
  await page.locator('.private-toggle .switch').click()
  await field(page, 'Private Host').fill('e2e-private.invalid')
  await field(page, 'Private Port').fill('8082')
  await page.getByRole('button', { name: 'Update Node' }).click()
  await expectToast(page, 'success', 'Updated Node')
  await page.goto(url)
  await expect(page.locator('.nodeview h1')).toHaveText(`${name}-edited`)
  await expect(field(page, 'Public Port')).toHaveValue('8081')
  await expect(field(page, 'Private Host')).toHaveValue('e2e-private.invalid')
  await expect(field(page, 'Private Port')).toHaveValue('8082')

  // the deploy button opens the same steps again
  await page.getByRole('button', { name: 'Deploy Node' }).click()
  await walkDeployment(page, '5657')

  await page.getByRole('button', { name: 'Delete Node' }).click()
  await confirmDialog(page, 'Delete Node')
  await expectToast(page, 'success', 'Deleted Node')
  await expect(page).toHaveURL(/\/nodes$/)
  await expect(page.locator('.nodelist .list-item').first()).toBeVisible()
  await expect(nodeLink(page, `${name}-edited`)).toHaveCount(0)
})
