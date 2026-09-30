import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function makeImage(page: Page, transparent = false, width = 288, height = 192) {
  const data = await page.evaluate(
    ({ transparent, width, height }) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')!
      if (!transparent) {
        const gradient = context.createLinearGradient(0, 0, width, height)
        gradient.addColorStop(0, '#83a38a')
        gradient.addColorStop(1, '#eaae7a')
        context.fillStyle = gradient
        context.fillRect(0, 0, width, height)
      }
      context.fillStyle = '#ef8355'
      context.fillRect(width / 4, height / 4, width / 2, height / 2)
      context.fillStyle = '#fff'
      context.font = 'bold 22px sans-serif'
      context.fillText('CLEARIFY', width / 4 + 5, height / 2)
      return canvas.toDataURL('image/png').split(',')[1]
    },
    { transparent, width, height },
  )
  return { name: 'test-photo.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') }
}

async function processImage(page: Page) {
  await page.getByRole('button', { name: '一键变清晰', exact: true }).click()
  await expect(page.getByRole('button', { name: '下载高清图片' })).toBeVisible()
}

async function readDownload(page: Page) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载高清图片' }).click()
  const download = await pending
  const contents = await readFile((await download.path())!)
  const info = await page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes]))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    const info = {
      width: bitmap.width,
      height: bitmap.height,
      corner: Array.from(context.getImageData(0, 0, 1, 1).data),
      center: Array.from(context.getImageData(bitmap.width / 2, bitmap.height / 2, 1, 1).data),
    }
    bitmap.close()
    return info
  }, contents.toString('base64'))
  return { ...info, filename: download.suggestedFilename(), size: contents.length }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('homepage, comparison keyboard controls, fullscreen, and help dialogs work', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.getByRole('heading', { name: '图片高清增强', level: 1 })).toBeVisible()
  const slider = page.getByRole('slider', { name: '拖动查看增强前后对比' })
  await slider.focus()
  await slider.press('End')
  await expect(slider).toHaveAttribute('aria-valuenow', '100')
  await slider.press('Home')
  await expect(slider).toHaveAttribute('aria-valuenow', '0')
  await page.getByRole('button', { name: '放大查看图片' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '使用指南' }).click()
  await expect(page.getByRole('heading', { name: '三步，让清晰发生' })).toBeVisible()
  await page.getByRole('button', { name: '关闭弹窗' }).click()
  await page.getByRole('button', { name: '常见问题' }).click()
  await expect(page.getByText('Clearify 使用高质量 Lanczos', { exact: false })).toBeVisible()
  await page.getByText('下载会收费或添加水印吗？').click()
  await expect(page.getByText('所有增强和下载功能均可免费使用', { exact: false })).toBeVisible()
  expect(errors).toEqual([])
})

test('uploaded PNG is really enlarged 2× and can be downloaded and reopened after reload', async ({
  page,
}) => {
  const unexpectedRequests: string[] = []
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:5173'))
      unexpectedRequests.push(request.url())
  })
  await page.getByLabel('上传图片文件').setInputFiles(await makeImage(page))
  await expect(page.getByText('test-photo.png', { exact: true })).toBeVisible()
  await expect(page.getByText('576 × 384', { exact: true })).toBeVisible()
  await processImage(page)
  const downloaded = await readDownload(page)
  expect(downloaded).toMatchObject({ width: 576, height: 384, filename: 'test-photo-clearify.png' })
  expect(downloaded.size).toBeGreaterThan(1000)
  expect(downloaded.center[3]).toBe(255)
  expect(unexpectedRequests).toEqual([])
  await expect(page.getByRole('button', { name: '我的作品' })).toContainText('1')
  await page.reload()
  await page.getByRole('button', { name: '我的作品' }).click()
  await expect(page.getByRole('heading', { name: 'test-photo.png' })).toBeVisible()
  await page.getByRole('button', { name: '查看 test-photo.png' }).click()
  await expect(page.getByRole('button', { name: '下载高清图片' })).toBeVisible()
  await expect(page.getByRole('slider', { name: '拖动查看增强前后对比' })).toBeVisible()
})

test('4× PNG enhancement preserves transparency', async ({ page }) => {
  await page.getByLabel('上传图片文件').setInputFiles(await makeImage(page, true))
  await page.getByRole('button', { name: '4 倍放大' }).click()
  await page.getByRole('button', { name: '细节', exact: true }).click()
  await processImage(page)
  const downloaded = await readDownload(page)
  expect(downloaded.width).toBe(1152)
  expect(downloaded.height).toBe(768)
  expect(downloaded.corner[3]).toBe(0)
  expect(downloaded.center[3]).toBe(255)
})

test('JPG export has correct encoding, dimensions and white background', async ({ page }) => {
  await page.getByLabel('上传图片文件').setInputFiles(await makeImage(page, true))
  await page.getByLabel('下载格式').selectOption('image/jpeg')
  await processImage(page)
  const downloaded = await readDownload(page)
  expect(downloaded.filename).toBe('test-photo-clearify.jpg')
  expect(downloaded.width).toBe(576)
  expect(downloaded.height).toBe(384)
  expect(downloaded.corner).toEqual([255, 255, 255, 255])
})

test('WebP export keeps transparency, and changing options requires a fresh result', async ({
  page,
}) => {
  await page.getByLabel('上传图片文件').setInputFiles(await makeImage(page, true))
  await page.getByLabel('下载格式').selectOption('image/webp')
  await processImage(page)
  const downloaded = await readDownload(page)
  expect(downloaded.filename).toBe('test-photo-clearify.webp')
  expect(downloaded.corner[3]).toBe(0)
  await page.getByRole('switch', { name: '轻柔降噪' }).click()
  await expect(page.getByRole('button', { name: '下载高清图片' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '一键变清晰', exact: true })).toBeVisible()
})

test('invalid, corrupt and oversized files show useful errors without losing the selected photo', async ({
  page,
}) => {
  const input = page.getByLabel('上传图片文件')
  await input.setInputFiles(await makeImage(page))
  await input.setInputFiles({
    name: 'document.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('document'),
  })
  await expect(page.getByRole('alert')).toContainText('暂不支持这种文件')
  await expect(page.getByText('test-photo.png', { exact: true })).toBeVisible()
  await input.setInputFiles({
    name: 'corrupt.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not an image'),
  })
  await expect(page.getByRole('alert')).toContainText('文件可能已损坏')
  await input.setInputFiles({
    name: 'large.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
  })
  await expect(page.getByRole('alert')).toContainText('超过了 20 MB')
  await page.getByRole('button', { name: '移除图片' }).click()
  await expect(page.getByText('点击上传', { exact: true })).toBeVisible()
})

test('processing can be cancelled and restarted', async ({ page }) => {
  await page.getByLabel('上传图片文件').setInputFiles(await makeImage(page, false, 1500, 1000))
  await page.getByRole('button', { name: '4 倍放大' }).click()
  await page.getByRole('button', { name: '一键变清晰', exact: true }).click()
  await page.getByRole('button', { name: '取消处理' }).click()
  await expect(page.getByRole('status').filter({ hasText: '已取消处理' })).toBeVisible()
  await expect(page.getByRole('button', { name: '一键变清晰', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '2 倍放大' }).click()
  await processImage(page)
  await expect(page.locator('.result-dimensions')).toHaveText('3000 × 2000')
})

test('samples are usable and local works can be deleted', async ({ page }) => {
  await page.getByRole('button', { name: '使用自然风景示例' }).click()
  await expect(page.getByText('山湖之间.jpg', { exact: true })).toBeVisible()
  await processImage(page)
  await expect(page.getByRole('button', { name: '我的作品' })).toContainText('1')
  await page.getByRole('button', { name: '我的作品' }).click()
  await page.getByRole('button', { name: '删除 山湖之间.jpg' }).click()
  await expect(page.getByRole('heading', { name: '下一张清晰好图，从这里开始' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '我的作品' }).click()
  await expect(page.getByRole('heading', { name: '下一张清晰好图，从这里开始' })).toBeVisible()
})

test('mobile navigation, processing, and download have no horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.getByRole('button', { name: '打开导航' }).click()
  await page.getByRole('button', { name: '我的作品' }).click()
  await expect(page.getByRole('heading', { name: '下一张清晰好图，从这里开始' })).toBeVisible()
  await page.getByRole('button', { name: '打开导航' }).click()
  await page.getByRole('button', { name: '图片增强', exact: true }).click()
  await page.getByLabel('上传图片文件').setInputFiles(await makeImage(page))
  await processImage(page)
  const downloaded = await readDownload(page)
  expect(downloaded.width).toBe(576)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
})
