import { expect, test } from '@playwright/test'
import type { Download, Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function downloadBatch(page: Page, count: number) {
  const files: Download[] = []
  const collect = (file: Download) => files.push(file)
  page.on('download', collect)
  try {
    await page.getByRole('button', { name: `批量下载（${count}）` }).click()
    await expect.poll(() => files.length).toBe(count)
    await expect(page.getByRole('status')).toContainText(`已发起 ${count} 张图片下载`)
    return files
  } finally {
    page.off('download', collect)
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '视频提图', exact: true }).click()
})

test('extracts real frames and downloads only selected pictures as separate numbered files', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('button', { name: '试试示例' }).click()
  await expect(page.locator('.video-picture-card')).toHaveCount(3)
  await page.getByRole('button', { name: '预览图片 1', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '图片 1 大图预览' })).toBeVisible()
  await page.keyboard.press('Escape')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载图片 1', exact: true }).click()
  const file = await downloaded
  const bytes = await readFile((await file.path())!)
  expect(bytes[0]).toBe(0xff)
  expect(bytes[1]).toBe(0xd8)
  expect(file.suggestedFilename()).toBe('1.jpg')
  await page.getByRole('checkbox', { name: '选择图片 2', exact: true }).uncheck()
  const files = await downloadBatch(page, 2)
  expect(files.map((item) => item.suggestedFilename())).toEqual(['1.jpg', '3.jpg'])
  expect(await readFile((await files[0].path())!)).toEqual(bytes)
  const thirdImage = await readFile((await files[1].path())!)
  expect(thirdImage[0]).toBe(0xff)
  expect(thirdImage[1]).toBe(0xd8)
  expect(thirdImage.length).toBeGreaterThan(10000)
  expect(errors).toEqual([])
  await page.getByRole('button', { name: '增强图片 1', exact: true }).click()
  await expect(page.getByRole('heading', { name: '图片高清增强', level: 1 })).toBeVisible()
  await expect(page.getByText('图片已准备好', { exact: true })).toHaveCount(0)
  await expect(page.locator('.selected-file strong')).toHaveText('1.jpg')
  await page.getByRole('button', { name: '视频提图', exact: true }).click()
  await expect(page.locator('.video-picture-card')).toHaveCount(3)
})

test('local video extracts the requested PNG count and rejects invalid files', async ({ page }) => {
  await page.getByRole('tab', { name: '本地视频' }).click()
  await page
    .getByLabel('上传本地视频文件')
    .setInputFiles({ name: 'broken.txt', mimeType: 'text/plain', buffer: Buffer.from('text') })
  await expect(page.getByRole('alert')).toContainText('请选择 MP4')
  await page.getByLabel('上传本地视频文件').setInputFiles(resolve('public/videos/sample.mp4'))
  await page.getByLabel('视频提取方式').selectOption('interval')
  await page.getByLabel('提取图片数量').selectOption('6')
  await page.getByLabel('视频截图格式').selectOption('image/png')
  await page.getByRole('button', { name: '提取视频图片', exact: true }).click()
  await expect(page.locator('.video-picture-card')).toHaveCount(6)
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载图片 6', exact: true }).click()
  const download = await pending
  expect(download.suggestedFilename()).toBe('6.png')
  const bytes = await readFile((await download.path())!)
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(bytes.readUInt32BE(16)).toBe(960)
  expect(bytes.readUInt32BE(20)).toBe(640)
  const files = await downloadBatch(page, 6)
  expect(files.map((item) => item.suggestedFilename())).toEqual([
    '1.png',
    '2.png',
    '3.png',
    '4.png',
    '5.png',
    '6.png',
  ])
  for (const file of files) {
    const picture = await readFile((await file.path())!)
    expect(picture.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(picture.readUInt32BE(16)).toBe(960)
    expect(picture.readUInt32BE(20)).toBe(640)
  }
  await page.getByRole('checkbox', { name: '全选提取图片' }).uncheck()
  await expect(page.getByRole('button', { name: '批量下载（0）' })).toBeDisabled()
})

test('share form handles missing and blocked links, platform errors, and cancellation', async ({
  page,
}) => {
  await page.getByRole('button', { name: '提取视频图片', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('完整链接')
  await page.getByLabel('视频分享链接').fill('http://127.0.0.1:5173/')
  await page.getByRole('button', { name: '提取视频图片', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('公开')
  await page.route('**/api/video/resolve', async (route) =>
    route.fulfill({ status: 422, json: { error: '此分享链接需要登录或验证' } }),
  )
  await page.getByLabel('视频分享链接').fill('9.41 视频分享 https://v.douyin.com/test/')
  await page.getByRole('button', { name: '提取视频图片', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('登录或验证')
  await page.unroute('**/api/video/resolve')
  await page.route('**/api/video/resolve', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.fulfill({ status: 422, json: { error: 'late error' } }).catch(() => {})
  })
  await page.getByRole('button', { name: '提取视频图片', exact: true }).click()
  await page.getByRole('button', { name: '取消提取', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已取消提取')
  await expect(page.getByRole('button', { name: '提取视频图片', exact: true })).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('gallery response displays original pictures and supports individual downloads', async ({
  page,
}) => {
  const picture = await readFile(resolve('public/images/architecture.jpg'))
  const asset = `/api/video/assets/${'a'.repeat(48)}`
  await page.route('**/api/video/resolve', async (route) => {
    expect(route.request().postDataJSON().text).toContain('分享')
    await route.fulfill({
      json: {
        kind: 'gallery',
        title: '图文测试作品',
        source: 'https://example.com/share',
        images: [asset],
      },
    })
  })
  await page.route(`**${asset}`, async (route) =>
    route.fulfill({ contentType: 'image/jpeg', body: picture }),
  )
  await page.getByLabel('视频分享链接').fill('分享 https://example.com/post')
  await page.getByRole('button', { name: '提取视频图片', exact: true }).click()
  await expect(page.getByRole('heading', { name: '图文测试作品' })).toBeVisible()
  await expect(page.locator('.video-picture-card')).toHaveCount(1)
  await expect(page.locator('.video-result-title p')).toContainText('图文原图')
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载图片 1', exact: true }).click()
  const download = await pending
  expect(download.suggestedFilename()).toBe('1.jpg')
  expect(await readFile((await download.path())!)).toEqual(picture)
})

test('mobile video module remains usable and results fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: '试试示例' }).click()
  await expect(page.locator('.video-picture-card')).toHaveCount(3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.getByRole('button', { name: '预览图片 1', exact: true }).click()
  const modal = page.getByRole('dialog', { name: '图片 1 大图预览' })
  await expect(modal).toBeInViewport()
  expect(await modal.evaluate((element) => element.scrollWidth <= innerWidth)).toBeTruthy()
  await page.getByRole('button', { name: '关闭图片预览' }).click()
  await page.getByRole('button', { name: '打开导航' }).click()
  await page.getByRole('button', { name: '图片增强', exact: true }).click()
  await expect(page.getByRole('heading', { name: '图片高清增强' })).toBeVisible()
})
