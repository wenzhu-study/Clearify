import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const A4: [number, number] = [595.28, 841.89]

async function samplePdf(page: Page) {
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 650
    canvas.height = 920
    const context = canvas.getContext('2d')!
    context.fillStyle = '#f4f3ee'
    context.fillRect(0, 0, 650, 920)
    context.fillStyle = '#353b34'
    context.font = 'bold 23px sans-serif'
    context.fillText('SONG SHEET - TEST PAGE', 130, 85)
    context.font = '13px sans-serif'
    for (let group = 0; group < 6; group++) {
      const top = 132 + group * 116
      context.fillText(
        `${group + 1}    Am              G                 F                 Em`,
        68,
        top,
      )
      for (let line = 0; line < 5; line++) {
        context.fillRect(65, top + 20 + line * 10, 525, 1)
      }
      context.fillText('6 7  1 3  6 7     5 6  7 2  5 6     4 5  6 1', 83, top + 41)
      context.fillText('lyrics         clear notes          A4            measure', 85, top + 78)
    }
    return canvas.toDataURL('image/png').split(',')[1]
  })
  const source = await PDFDocument.create()
  const scanned = source.addPage(A4)
  const image = await source.embedPng(Buffer.from(png, 'base64'))
  scanned.drawImage(image, { x: 0, y: 0, width: A4[0], height: A4[1] })
  const vector = source.addPage(A4)
  const font = await source.embedFont(StandardFonts.Helvetica)
  for (let index = 0; index < 22; index++) {
    vector.drawText(`Vector text line ${index + 1}: keep original sharp type`, {
      x: 54,
      y: 760 - index * 29,
      size: 12,
      font,
      color: rgb(0.12, 0.17, 0.13),
    })
  }
  const bytes = Buffer.from(await source.save())
  await mkdir(resolve('.verification'), { recursive: true })
  await writeFile(resolve('.verification/pdf-sample-input.pdf'), bytes)
  return bytes
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'PDF 清晰' }).click()
  await expect(page.getByRole('heading', { name: 'PDF 一键清晰' })).toBeVisible()
})

test('two-page A4 PDF enhances scanned sheet, preserves vector text and downloads a valid document', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const sample = await samplePdf(page)
  await page
    .getByLabel('上传 PDF 文件')
    .setInputFiles({ name: 'song-sheet.pdf', mimeType: 'application/pdf', buffer: sample })
  await expect(page.getByRole('button', { name: '查看第 2 页' })).toBeVisible()
  await expect(page.getByText('扫描页面，可增强')).toBeVisible()
  await page.getByRole('button', { name: '一键清晰化' }).click()
  await expect(page.getByRole('button', { name: '下载清晰 PDF' })).toBeVisible({ timeout: 45_000 })
  await expect(page.getByText('1 页已增强 · 1 页保留矢量')).toBeVisible()
  const divider = page.getByRole('slider', { name: '拖动查看 PDF 清晰前后对比' })
  await divider.fill('70')
  await expect(divider).toHaveValue('70')
  await page.getByRole('button', { name: '查看第 2 页' }).click()
  await expect(page.getByText('可选择文字 · 原始矢量已保留')).toBeVisible()
  await page.getByRole('button', { name: '清晰页' }).click()
  await expect(page.getByAltText('第 2 页清晰效果')).toBeVisible()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载清晰 PDF' }).click()
  const download = await pending
  expect(download.suggestedFilename()).toBe('song-sheet-clearify.pdf')
  const output = await readFile((await download.path())!)
  await writeFile(resolve('.verification/pdf-sample-output.pdf'), output)
  const pdf = await PDFDocument.load(output)
  expect(pdf.getPageCount()).toBe(2)
  for (const item of pdf.getPages()) {
    expect(item.getWidth()).toBeCloseTo(A4[0], 1)
    expect(item.getHeight()).toBeCloseTo(A4[1], 1)
  }
  expect(output.length).toBeGreaterThan(200_000)
  expect(errors).toEqual([])
})

test('force mode processes both pages, and changing quality requires reprocessing', async ({
  page,
}) => {
  const sample = await samplePdf(page)
  await page
    .getByLabel('上传 PDF 文件')
    .setInputFiles({ name: 'score.pdf', mimeType: 'application/pdf', buffer: sample })
  await expect(page.getByRole('button', { name: '查看第 2 页' })).toBeVisible()
  await page.getByLabel('处理方式').selectOption('all')
  await page.getByLabel('输出清晰度').selectOption('288')
  await page.getByRole('button', { name: '一键清晰化' }).click()
  await expect(page.getByRole('button', { name: '下载清晰 PDF' })).toBeVisible({ timeout: 45_000 })
  await expect(page.getByText('2 页已增强', { exact: true })).toBeVisible()
  await page.getByLabel('输出清晰度').selectOption('216')
  await expect(page.getByRole('button', { name: '一键清晰化' })).toBeVisible()
  await expect(page.getByRole('button', { name: '下载清晰 PDF' })).toHaveCount(0)
})

test('invalid PDF input displays useful error and mobile page preview fits viewport', async ({
  page,
}) => {
  const input = page.getByLabel('上传 PDF 文件')
  await input.setInputFiles({
    name: 'bad.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('not pdf'),
  })
  await expect(page.getByRole('alert')).toContainText('不是完整的 PDF')
  await input.setInputFiles({
    name: 'huge.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(35 * 1024 * 1024 + 1),
  })
  await expect(page.getByRole('alert')).toContainText('超过 35 MB')
  await page.setViewportSize({ width: 390, height: 844 })
  const sample = await samplePdf(page)
  await input.setInputFiles({ name: 'score.pdf', mimeType: 'application/pdf', buffer: sample })
  await expect(page.getByRole('button', { name: '查看第 2 页' })).toBeVisible()
  await page.getByRole('button', { name: '下一页' }).click()
  await expect(page.getByText('检测到可选择文字，将保留矢量')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
})

test('interactive form PDFs are declined instead of silently losing their fields', async ({
  page,
}) => {
  const document = await PDFDocument.create()
  const formPage = document.addPage(A4)
  const field = document.getForm().createTextField('recipient')
  field.setText('keep this data')
  field.addToPage(formPage, { x: 45, y: 730, width: 210, height: 28 })
  await page.getByLabel('上传 PDF 文件').setInputFiles({
    name: 'form.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await document.save()),
  })
  await expect(page.getByRole('alert')).toContainText('交互表单')
  await expect(page.getByRole('button', { name: '下载清晰 PDF' })).toHaveCount(0)
})

test('a page with only a single line of vector text stays searchable', async ({ page }) => {
  const document = await PDFDocument.create()
  const vector = document.addPage(A4)
  vector.drawText('A short, sharp notation line', {
    x: 45,
    y: 720,
    font: await document.embedFont(StandardFonts.Helvetica),
    size: 14,
  })
  await page.getByLabel('上传 PDF 文件').setInputFiles({
    name: 'short-score.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await document.save()),
  })
  await expect(page.getByText('检测到可选择文字，将保留矢量')).toBeVisible()
  await page.getByRole('button', { name: '一键清晰化' }).click()
  await expect(page.getByRole('button', { name: '下载清晰 PDF' })).toBeVisible()
  await expect(page.getByText('0 页已增强 · 1 页保留矢量')).toBeVisible()
})
