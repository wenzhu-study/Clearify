import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('large preview fills the workspace and immersive mode fills the window', async ({ page }) => {
  const mainCanvas = await page
    .getByRole('region', { name: '图片预览画布', exact: true })
    .boundingBox()
  expect(mainCanvas!.width).toBeGreaterThan(1100)
  expect(mainCanvas!.height).toBeGreaterThan(650)
  const controls = await page.locator('#enhance-controls').boundingBox()
  expect(controls!.y).toBeGreaterThan(mainCanvas!.y + mainCanvas!.height)
  await page.getByRole('button', { name: '放大查看图片' }).click()
  const dialog = page.getByRole('dialog', { name: '全屏图片预览' })
  expect(await dialog.boundingBox()).toEqual({ x: 0, y: 0, width: 1440, height: 1000 })
  const fullscreenCanvas = await dialog.getByRole('region', { name: '全屏图片画布' }).boundingBox()
  expect(fullscreenCanvas!.width).toBe(1440)
  expect(fullscreenCanvas!.height).toBeGreaterThan(800)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('actual-pixel zoom, pan and comparison stay aligned at high magnification', async ({
  page,
}) => {
  await page.getByRole('button', { name: '放大查看图片' }).click()
  const dialog = page.getByRole('dialog')
  const canvas = dialog.getByRole('region', { name: '全屏图片画布' })
  await dialog.getByRole('button', { name: '100% 实际像素', exact: true }).click()
  const image = canvas.locator(':scope > .compare-image')
  await expect(image).toHaveCSS('width', '1600px')
  await dialog.getByRole('button', { name: '200% 预览缩放' }).click()
  await expect(image).toHaveCSS('width', '3200px')
  const bounds = (await canvas.boundingBox())!
  const beforePan = await image.boundingBox()
  await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.45)
  await page.mouse.down()
  await page.mouse.move(
    bounds.x + bounds.width * 0.25 + 120,
    bounds.y + bounds.height * 0.45 + 70,
    { steps: 8 },
  )
  await page.mouse.up()
  const afterPan = (await image.boundingBox())!
  expect(afterPan.x - beforePan!.x).toBeCloseTo(120, 0)
  expect(afterPan.y - beforePan!.y).toBeCloseTo(70, 0)
  const original = canvas.locator('.before-layer .compare-image')
  expect(await original.boundingBox()).toEqual(afterPan)
  const divider = dialog.getByRole('slider', { name: '全屏对比位置' })
  const grip = (await divider.locator('.comparison-grip').boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.72, grip.y + grip.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(divider).toHaveAttribute('aria-valuenow', '72')
  expect(await image.boundingBox()).toEqual(afterPan)
  expect(await original.boundingBox()).toEqual(afterPan)
  await dialog.getByRole('button', { name: '400% 预览缩放' }).click()
  await expect(image).toHaveCSS('width', '6400px')
  await dialog.getByRole('button', { name: '增强效果', exact: true }).click()
  await expect(canvas.locator('.before-layer')).toHaveCount(0)
  await expect(image).toHaveCSS('width', '6400px')
  await dialog.getByRole('button', { name: '前后对比', exact: true }).click()
  await canvas.focus()
  await canvas.press('0')
  await expect(dialog.getByRole('button', { name: '适应窗口' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect((await image.boundingBox())!.width).toBeLessThanOrEqual(bounds.width)
})

test('wheel zoom and mobile fullscreen keep usable controls without overflow', async ({ page }) => {
  await page.getByRole('button', { name: '放大查看图片' }).click()
  const dialog = page.getByRole('dialog')
  const canvas = dialog.getByRole('region', { name: '全屏图片画布' })
  const image = canvas.locator(':scope > .compare-image')
  await dialog.getByRole('button', { name: '100% 实际像素', exact: true }).click()
  await canvas.hover({ position: { x: 350, y: 220 } })
  await page.mouse.wheel(0, -160)
  await expect
    .poll(async () =>
      parseFloat(await image.evaluate((element) => getComputedStyle(element).width)),
    )
    .toBeGreaterThan(1600)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await dialog.getByRole('button', { name: '适应窗口' }).click()
  await expect.poll(async () => (await dialog.boundingBox())?.width).toBe(390)
  const mobileBounds = (await canvas.boundingBox())!
  expect(mobileBounds.height).toBeGreaterThan(600)
  expect(await dialog.evaluate((element) => element.scrollWidth <= innerWidth)).toBeTruthy()
  await dialog.getByRole('button', { name: '400% 预览缩放' }).click()
  await expect(image).toHaveCSS('width', '6400px')
  await expect(dialog.getByRole('button', { name: '关闭弹窗' })).toBeInViewport()
  await dialog.getByRole('button', { name: '关闭弹窗' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
})
