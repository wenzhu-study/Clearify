import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  FolderOpen,
  LoaderCircle,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import type { PdfInspection, PdfMode, PdfPageInfo, PdfQuality } from './pdf-processing'
import { enhancePdf, inspectPdf } from './pdf-processing'
import { formatBytes } from './types'

type PdfResult = { blob: Blob; pages: PdfPageInfo[] }
type DisplayMode = 'compare' | 'original' | 'enhanced'

export default function PdfEnhancer() {
  const input = useRef<HTMLInputElement>(null)
  const controller = useRef<AbortController | null>(null)
  const run = useRef(0)
  const [file, setFile] = useState<File | null>(null)
  const [inspected, setInspected] = useState<PdfInspection | null>(null)
  const [result, setResult] = useState<PdfResult | null>(null)
  const [mode, setMode] = useState<PdfMode>('auto')
  const [quality, setQuality] = useState<PdfQuality>(216)
  const [pageNumber, setPageNumber] = useState(1)
  const [display, setDisplay] = useState<DisplayMode>('compare')
  const [divider, setDivider] = useState(50)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const [stage, setStage] = useState('')
  const [progress, setProgress] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [previewUrls, setPreviewUrls] = useState<{ original: string; enhanced?: string }[]>([])

  useEffect(
    () => () => {
      controller.current?.abort()
    },
    [],
  )
  useEffect(() => {
    if (!inspected) {
      setPreviewUrls([])
      return
    }
    const urls = inspected.pages.map((page, index) => ({
      original: URL.createObjectURL(page.original),
      enhanced: result?.pages[index]?.enhanced
        ? URL.createObjectURL(result.pages[index].enhanced)
        : undefined,
    }))
    setPreviewUrls(urls)
    return () => {
      for (const url of urls) {
        URL.revokeObjectURL(url.original)
        if (url.enhanced) URL.revokeObjectURL(url.enhanced)
      }
    }
  }, [inspected, result])

  const choose = async (next: File) => {
    if (working) return
    setError('')
    if (!/\.pdf$/i.test(next.name) && next.type !== 'application/pdf') {
      setError('请选择 PDF 文件。')
      return
    }
    if (next.size > 35 * 1024 * 1024) {
      setError('PDF 超过 35 MB，请拆分后再上传。')
      return
    }
    if (new TextDecoder().decode(await next.slice(0, 5).arrayBuffer()) !== '%PDF-') {
      setError('这不是完整的 PDF 文件，请重新选择。')
      return
    }
    const abort = new AbortController()
    const id = ++run.current
    controller.current = abort
    setWorking(true)
    setStage('正在读取 PDF 页面…')
    setProgress(0)
    setFile(null)
    setInspected(null)
    setResult(null)
    setPageNumber(1)
    try {
      const details = await inspectPdf(next, abort.signal, (done, total) =>
        setProgress(Math.round((done / total) * 100)),
      )
      if (id !== run.current) return
      setFile(next)
      setInspected(details)
    } catch (reason) {
      if (id === run.current && !abort.signal.aborted)
        setError(reason instanceof Error ? reason.message : '无法读取 PDF。')
    } finally {
      if (id === run.current) {
        controller.current = null
        setWorking(false)
      }
    }
  }

  const enhance = async () => {
    if (!file || !inspected || working) return
    const abort = new AbortController()
    const id = ++run.current
    controller.current = abort
    setWorking(true)
    setError('')
    setProgress(0)
    setStage('正在逐页清晰化…')
    setResult(null)
    try {
      const next = await enhancePdf(
        file,
        inspected,
        { mode, quality },
        abort.signal,
        (done, total) => setProgress(Math.round((done / total) * 100)),
      )
      if (id !== run.current) return
      setResult(next)
      setDisplay('compare')
      setDivider(50)
    } catch (reason) {
      if (id === run.current && !abort.signal.aborted)
        setError(reason instanceof Error ? reason.message : 'PDF 处理失败，请重试。')
    } finally {
      if (id === run.current) {
        controller.current = null
        setWorking(false)
      }
    }
  }

  const cancel = () => {
    controller.current?.abort()
    controller.current = null
    run.current++
    setWorking(false)
    setStage('')
    setError('已取消处理。')
  }
  const reset = () => {
    if (working) return
    setFile(null)
    setInspected(null)
    setResult(null)
    setError('')
    setPageNumber(1)
  }
  const download = () => {
    if (!result || !file) return
    const url = URL.createObjectURL(result.blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${file.name.replace(/\.pdf$/i, '')}-clearify.pdf`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
  }

  const page = inspected?.pages[pageNumber - 1]
  const processed = result?.pages[pageNumber - 1]
  const images = previewUrls[pageNumber - 1]
  const output = images?.enhanced || images?.original
  const keepCount = result?.pages.filter((item) => !item.processed).length || 0
  const progressLabel = `${progress}%`

  return (
    <section className="pdf-workspace" aria-label="PDF 清晰化工作台">
      <input
        className="visually-hidden"
        type="file"
        ref={input}
        accept=".pdf,application/pdf"
        aria-label="上传 PDF 文件"
        disabled={working}
        onChange={(event) => {
          const selected = event.target.files?.[0]
          if (selected) void choose(selected)
          event.target.value = ''
        }}
      />
      <div className="pdf-controls">
        <div
          className={`pdf-file-area ${dragging ? 'dragging' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            if (!working) setDragging(true)
          }}
          onDragLeave={(event) => {
            event.preventDefault()
            setDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            if (working) return
            if (event.dataTransfer.files.length !== 1) {
              setError('请一次选择一个 PDF 文件。')
              return
            }
            void choose(event.dataTransfer.files[0])
          }}
        >
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={working}
            aria-label={file ? '更换 PDF 文件' : '选择 PDF 文件'}
          >
            <span className="pdf-file-icon">
              {file ? <FileText size={22} /> : <Upload size={22} />}
            </span>
            <span className="pdf-file-description">
              <strong title={file?.name}>{file?.name || '选择 PDF 或拖入文件'}</strong>
              <small>
                {file
                  ? `${inspected?.pages.length} 页 · ${formatBytes(file.size)}`
                  : '支持多页 A4 文档 · 单文件最大 35 MB'}
              </small>
            </span>
            {file && <FolderOpen size={17} className="pdf-replace-icon" />}
          </button>
          {file && (
            <button className="pdf-remove" aria-label="移除 PDF" disabled={working} onClick={reset}>
              <X size={16} />
            </button>
          )}
        </div>
        <div className="pdf-settings">
          <div className="pdf-setting">
            <label htmlFor="pdf-mode">处理方式</label>
            <span className="pdf-select">
              <select
                id="pdf-mode"
                disabled={working}
                value={mode}
                onChange={(event) => {
                  setMode(event.target.value as PdfMode)
                  setResult(null)
                }}
              >
                <option value="auto">智能保留文字</option>
                <option value="all" disabled={inspected?.hasForms}>
                  全部增强
                </option>
              </select>
            </span>
          </div>
          <div className="pdf-setting">
            <label htmlFor="pdf-quality">输出清晰度</label>
            <span className="pdf-select">
              <select
                id="pdf-quality"
                disabled={working}
                value={quality}
                onChange={(event) => {
                  setQuality(Number(event.target.value) as PdfQuality)
                  setResult(null)
                }}
              >
                <option value={216}>清晰 · 216 DPI</option>
                <option value={288}>超清 · 288 DPI</option>
              </select>
            </span>
          </div>
          {mode === 'all' && (
            <span className="pdf-mode-warning">全部增强会将文字转成图片，无法再复制文字。</span>
          )}
        </div>
        <div className="pdf-primary-actions">
          {result ? (
            <button className="pdf-primary pdf-ready" onClick={download}>
              <Download size={18} />
              下载清晰 PDF
            </button>
          ) : (
            <button
              className="pdf-primary"
              disabled={working}
              onClick={() => (file ? void enhance() : input.current?.click())}
            >
              {working ? <LoaderCircle size={18} className="spin" /> : <Sparkles size={18} />}
              {working ? `${stage} ${progressLabel}` : '一键清晰化'}
            </button>
          )}
          {working ? (
            <button className="pdf-secondary" onClick={cancel}>
              取消处理
            </button>
          ) : (
            <span className="pdf-private">
              <ShieldCheck size={13} />
              文件仅在浏览器内处理
            </span>
          )}
        </div>
      </div>
      {error && (
        <div className="pdf-error" role="alert">
          <span>{error}</span>
          <button aria-label="关闭 PDF 提示" onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {working && (
        <div className="pdf-progress" role="status">
          <span>{stage}</span>
          <div>
            <span style={{ width: `${progress}%` }} />
          </div>
          <b>{progressLabel}</b>
        </div>
      )}
      {inspected && (
        <div className="pdf-document">
          <div className="pdf-document-bar">
            <span>
              <FileText size={16} />
              {file?.name}
            </span>
            <div>
              {result ? (
                <span className="pdf-done">
                  <Check size={14} />
                  {result.pages.length - keepCount} 页已增强
                  {keepCount > 0 ? ` · ${keepCount} 页保留矢量` : ''}
                </span>
              ) : (
                `${inspected.pages.length} 页 · A4 文档优先`
              )}
            </div>
          </div>
          <div className="pdf-document-body">
            <aside className="pdf-thumbs" aria-label="PDF 页码">
              {inspected.pages.map((entry, index) => (
                <button
                  className={`pdf-thumb ${pageNumber === entry.number ? 'selected' : ''}`}
                  key={entry.number}
                  onClick={() => {
                    setPageNumber(entry.number)
                    setDivider(50)
                  }}
                  aria-label={`查看第 ${entry.number} 页`}
                  aria-current={pageNumber === entry.number ? 'page' : undefined}
                >
                  <img src={previewUrls[index]?.original} alt="" />
                  <span>第 {entry.number} 页</span>
                  {result && <small>{result.pages[index].processed ? '已增强' : '保留原文'}</small>}
                </button>
              ))}
            </aside>
            <div className="pdf-preview-column">
              <div className="pdf-preview-header">
                <span>
                  第 {pageNumber} / {inspected.pages.length} 页
                </span>
                <div className="pdf-view-modes" role="group" aria-label="PDF 预览方式">
                  <button
                    disabled={!result}
                    className={display === 'compare' ? 'selected' : ''}
                    onClick={() => setDisplay('compare')}
                  >
                    <SlidersHorizontal size={15} />
                    对比
                  </button>
                  <button
                    className={display === 'original' ? 'selected' : ''}
                    onClick={() => setDisplay('original')}
                  >
                    原页
                  </button>
                  <button
                    disabled={!result}
                    className={display === 'enhanced' ? 'selected' : ''}
                    onClick={() => setDisplay('enhanced')}
                  >
                    清晰页
                  </button>
                </div>
                <span className="pdf-page-dimensions">
                  {page ? `${Math.round(page.width)} × ${Math.round(page.height)} pt` : ''}
                </span>
              </div>
              <div className="pdf-preview-surface">
                {images && (
                  <div
                    className="pdf-paper"
                    style={{ aspectRatio: `${page!.width} / ${page!.height}` }}
                  >
                    <img
                      className="pdf-page-image"
                      src={display === 'original' || !result ? images.original : output}
                      alt={`第 ${pageNumber} 页${result && display !== 'original' ? '清晰效果' : '原页'}`}
                    />
                    {result && display === 'compare' && (
                      <>
                        <div
                          className="pdf-original-layer"
                          style={{ clipPath: `inset(0 ${100 - divider}% 0 0)` }}
                        >
                          <img className="pdf-page-image" src={images.original} alt="" />
                        </div>
                        <div
                          className="pdf-divider"
                          style={{ left: `${divider}%` }}
                          aria-hidden="true"
                        >
                          <span>
                            <ChevronLeft size={14} />
                            <ChevronRight size={14} />
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={divider}
                          onChange={(event) => setDivider(Number(event.target.value))}
                          aria-label="拖动查看 PDF 清晰前后对比"
                          className="pdf-compare-range"
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="pdf-preview-footer">
                <button
                  aria-label="上一页"
                  disabled={pageNumber <= 1}
                  onClick={() => setPageNumber(pageNumber - 1)}
                >
                  <ChevronLeft size={18} />
                  上一页
                </button>
                <span>
                  {result
                    ? processed?.processed
                      ? '扫描页 · 已提升分辨率和文字边缘'
                      : '可选择文字 · 原始矢量已保留'
                    : page?.vector
                      ? '检测到可选择文字，将保留矢量'
                      : '扫描页面，可增强'}
                </span>
                <button
                  aria-label="下一页"
                  disabled={pageNumber >= inspected.pages.length}
                  onClick={() => setPageNumber(pageNumber + 1)}
                >
                  下一页
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {!inspected && !working && (
        <div className="pdf-empty">
          <div>
            <ScanLine size={34} strokeWidth={1.2} />
            <FileText size={24} />
          </div>
          <h2>让 A4 文档里的每一行，都更清楚</h2>
          <p>上传 PDF，逐页预览，处理完成后直接下载完整文档。</p>
          <span>扫描稿、讲义、谱页、打印资料均可处理</span>
        </div>
      )}
    </section>
  )
}
