import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardPaste,
  Download,
  Expand,
  FileVideo,
  Film,
  Image as ImageIcon,
  Images,
  Link,
  LoaderCircle,
  Play,
  ShieldCheck,
  Sparkles,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react'
import type {
  ExtractedPicture,
  ExtractionMode,
  FrameFormat,
  ResolvedShare,
} from './video-extraction'
import {
  downloadPictures,
  extractFrames,
  pictureName,
  readGallery,
  responseError,
  saveBlob,
  timestamp,
} from './video-extraction'
import { formatBytes } from './types'

type Picture = ExtractedPicture & { url: string }
type Extraction = {
  title: string
  kind: 'gallery' | 'video'
  source?: string
  author?: string
  duration?: number
  pictures: Picture[]
}

export default function VideoExtractor({
  onEnhance,
}: {
  onEnhance: (blob: Blob, name: string) => void
}) {
  const [tab, setTab] = useState<'link' | 'file'>('link')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<ExtractionMode>('smart')
  const [count, setCount] = useState(12)
  const [format, setFormat] = useState<FrameFormat>('image/jpeg')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [found, setFound] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dragging, setDragging] = useState(false)
  const [result, setResult] = useState<Extraction | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [downloadProgress, setDownloadProgress] = useState<{ done: number; total: number } | null>(
    null,
  )
  const [preview, setPreview] = useState<Picture | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const shareInput = useRef<HTMLInputElement>(null)
  const controller = useRef<AbortController | null>(null)
  const downloadController = useRef<AbortController | null>(null)
  const urls = useRef<string[]>([])
  const dialog = useRef<HTMLDialogElement>(null)
  const sequence = useRef(0)

  useEffect(
    () => () => {
      controller.current?.abort()
      downloadController.current?.abort()
      urls.current.forEach(URL.revokeObjectURL)
    },
    [],
  )
  useEffect(() => {
    if (!preview) return
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current!
    element.showModal()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      element.close()
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [preview])

  const selectFile = (next: File) => {
    if (busy) return
    setError('')
    setNotice('')
    setPreview(null)
    if (next.size > 100 * 1024 * 1024) {
      setError('视频超过 100 MB，请选择更小的文件。')
      return
    }
    if (
      !/\.(mp4|webm|mov|m4v)$/i.test(next.name) &&
      !['video/mp4', 'video/webm', 'video/quicktime'].includes(next.type)
    ) {
      setError('请选择 MP4、WebM 或 MOV 视频文件。')
      return
    }
    setFile(next)
    setTab('file')
  }

  const start = async (demo = false) => {
    if (busy) return
    setError('')
    setNotice('')
    if (!demo && tab === 'link' && !/https?:\/\//i.test(text)) {
      setError('请粘贴包含完整链接的分享文案，再点击提取。')
      shareInput.current?.focus()
      return
    }
    if (!demo && tab === 'file' && !file) {
      input.current?.click()
      return
    }
    const abort = new AbortController()
    controller.current = abort
    const run = ++sequence.current
    setBusy(true)
    setProgress(null)
    setFound(0)
    setStage(
      demo ? '正在读取示例视频…' : tab === 'link' ? '正在解析分享链接…' : '正在读取本地视频…',
    )
    try {
      let title = file ? file.name.replace(/\.[^.]+$/, '') : '视频图片'
      let source: string | undefined, author: string | undefined, duration: number | undefined
      let kind: 'video' | 'gallery' = 'video'
      let pictures: ExtractedPicture[] = []
      let video: Blob | null = null
      if (demo) {
        const response = await fetch('/videos/sample.mp4', { signal: abort.signal })
        if (!response.ok) throw new Error('示例视频暂时不可用，请上传自己的视频。')
        video = await response.blob()
        title = '山湖与光影 · 示例视频'
      } else if (tab === 'file') video = file
      else {
        const response = await fetch('/api/video/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: abort.signal,
        })
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
          throw await responseError(response)
        const resolved: ResolvedShare = await response.json()
        title = resolved.title
        source = resolved.source
        author = resolved.author
        kind = resolved.kind
        const localAsset = (value: string) => /^\/api\/video\/assets\/[a-f0-9]{48}$/.test(value)
        if (kind === 'gallery' && resolved.images?.length && resolved.images.every(localAsset)) {
          setStage('正在读取图文原图…')
          const gallery = await readGallery(resolved.images, abort.signal, (done, total) => {
            setProgress(Math.round((done / total) * 100))
            setFound(done)
          })
          pictures = gallery.pictures
          if (gallery.failed)
            setNotice(
              `已提取 ${pictures.length} 张图片，另有 ${gallery.failed} 张暂时无法读取。可重新解析后再试。`,
            )
        } else if (kind === 'video' && resolved.video && localAsset(resolved.video)) {
          setStage('正在读取视频文件…')
          const media = await fetch(resolved.video, { signal: abort.signal })
          if (!media.ok) throw await responseError(media)
          video = await media.blob()
        } else throw new Error('这个链接没有返回可读取的图片或视频，请换一个链接。')
      }
      if (video) {
        setStage(mode === 'smart' ? '正在提取画面，过滤相似图片…' : '正在按时间提取画面…')
        const extracted = await extractFrames(video, {
          count,
          mode,
          format,
          signal: abort.signal,
          onProgress: (value, total) => {
            setProgress(value)
            setFound(total)
          },
        })
        pictures = extracted.pictures
        duration = extracted.duration
      }
      abort.signal.throwIfAborted()
      if (sequence.current !== run) return
      const next = pictures.map((item) => ({ ...item, url: URL.createObjectURL(item.blob) }))
      setPreview(null)
      urls.current.forEach(URL.revokeObjectURL)
      urls.current = next.map((item) => item.url)
      setResult({ title, source, author, duration, kind, pictures: next })
      setSelected(new Set(next.map((item) => item.id)))
      setProgress(100)
    } catch (reason) {
      if (sequence.current !== run) return
      if (abort.signal.aborted) setNotice('已取消提取，你可以修改设置后重新开始。')
      else setError(reason instanceof Error ? reason.message : '提取失败，请稍后重试。')
    } finally {
      if (sequence.current === run) {
        setBusy(false)
        controller.current = null
      }
    }
  }

  const paste = async () => {
    try {
      const value = await navigator.clipboard.readText()
      if (!value.trim()) {
        setNotice('剪贴板中没有文字，请先复制分享链接。')
        return
      }
      setText(value.slice(0, 12000))
      setError('')
      setNotice('')
      shareInput.current?.focus()
    } catch {
      setNotice('无法自动读取剪贴板，请点击输入框后按 Ctrl / ⌘ + V 粘贴。')
      shareInput.current?.focus()
    }
  }
  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const downloadSelected = async () => {
    if (!result || !selected.size || downloadController.current) return
    const pictures = result.pictures.filter((item) => selected.has(item.id))
    const abort = new AbortController()
    downloadController.current = abort
    setDownloadProgress({ done: 0, total: pictures.length })
    setError('')
    setNotice('正在逐张下载图片；如果浏览器询问是否允许下载多个文件，请选择允许。')
    try {
      await downloadPictures(pictures, abort.signal, (done) =>
        setDownloadProgress({ done, total: pictures.length }),
      )
      setNotice(
        `已发起 ${pictures.length} 张图片下载，文件名按图片序号排列。若只收到一张，请允许浏览器下载多个文件。`,
      )
    } catch {
      if (!abort.signal.aborted) setError('部分图片未能发起下载，请重试或点击对应图片单独下载。')
    } finally {
      downloadController.current = null
      if (!abort.signal.aborted) setDownloadProgress(null)
    }
  }
  const download = (item: Picture) => saveBlob(item.blob, pictureName(item))
  const enhancePicture = async (item: Picture) => {
    if (!result) return
    if (['image/png', 'image/jpeg', 'image/webp'].includes(item.blob.type)) {
      onEnhance(item.blob, pictureName(item))
      return
    }
    let bitmap: ImageBitmap | null = null
    try {
      bitmap = await createImageBitmap(item.blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
      const png = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('图片转换失败'))),
          'image/png',
        ),
      )
      onEnhance(png, pictureName(item).replace(/\.[^.]+$/, '.png'))
    } catch {
      setError('暂时无法将这张图片转为增强格式，请先下载原图。')
    } finally {
      bitmap?.close()
    }
  }

  return (
    <section className="video-workspace" aria-label="视频图片提取工作台">
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        accept="video/mp4,video/webm,video/quicktime,.mov,.m4v"
        aria-label="上传本地视频文件"
        disabled={busy}
        onChange={(event) => {
          const next = event.target.files?.[0]
          if (next) selectFile(next)
          event.target.value = ''
        }}
      />
      <div className="video-input-card">
        <div className="video-input-top">
          <div className="video-source-tabs" role="tablist" aria-label="视频来源">
            <button
              role="tab"
              aria-selected={tab === 'link'}
              disabled={busy}
              onClick={() => {
                setTab('link')
                setError('')
              }}
            >
              <Link size={15} />
              分享链接
            </button>
            <button
              role="tab"
              aria-selected={tab === 'file'}
              disabled={busy}
              onClick={() => {
                setTab('file')
                setError('')
              }}
            >
              <FileVideo size={15} />
              本地视频
            </button>
          </div>
          <button className="video-demo-button" disabled={busy} onClick={() => void start(true)}>
            <Play size={12} />
            试试示例
            <ArrowRight size={12} />
          </button>
        </div>
        <form
          className="video-link-form"
          onSubmit={(event) => {
            event.preventDefault()
            void start()
          }}
        >
          {tab === 'link' ? (
            <div className="video-share-field">
              <Link size={19} />
              <input
                ref={shareInput}
                aria-label="视频分享链接"
                placeholder="粘贴 APP 或网站复制的链接，也可以直接粘贴整段分享文案"
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={12000}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
              />
              {text && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="清空分享链接"
                  disabled={busy}
                  onClick={() => {
                    setText('')
                    setError('')
                    shareInput.current?.focus()
                  }}
                >
                  <X size={16} />
                </button>
              )}
              <button
                type="button"
                className="icon-button paste-link"
                aria-label="粘贴分享链接"
                title="粘贴分享链接"
                disabled={busy}
                onClick={() => void paste()}
              >
                <ClipboardPaste size={18} />
              </button>
            </div>
          ) : (
            <div
              className={`video-local-field ${dragging ? 'dragging' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                if (!busy) setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                if (event.dataTransfer.files.length > 1) {
                  setError('一次请选择一个视频。')
                  return
                }
                if (event.dataTransfer.files[0]) selectFile(event.dataTransfer.files[0])
              }}
            >
              <button type="button" disabled={busy} onClick={() => input.current?.click()}>
                <Upload size={19} />
                <span>
                  {file ? (
                    <>
                      <b>{file.name}</b>
                      <small>{formatBytes(file.size)} · 点击更换</small>
                    </>
                  ) : (
                    <>
                      <b>选择视频或拖拽到这里</b>
                      <small>MP4、WebM、MOV · 最大 100 MB</small>
                    </>
                  )}
                </span>
              </button>
              {file && (
                <button
                  className="icon-button"
                  type="button"
                  disabled={busy}
                  aria-label="移除本地视频"
                  onClick={() => setFile(null)}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          )}
          <button type="submit" className="extract-button" disabled={busy}>
            {busy ? <LoaderCircle size={17} className="spin" /> : <ArrowDownToLine size={17} />}
            <span>{busy ? '正在提取' : '提取视频图片'}</span>
          </button>
        </form>
        <fieldset className="video-options" disabled={busy}>
          <label>
            <span>视频提取</span>
            <div className="video-select">
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as ExtractionMode)}
                aria-label="视频提取方式"
              >
                <option value="smart">自动去重</option>
                <option value="interval">等距截图</option>
              </select>
              <ChevronDown size={12} />
            </div>
          </label>
          <label>
            <span>{mode === 'smart' ? '最多提取' : '提取数量'}</span>
            <div className="video-select">
              <select
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
                aria-label="提取图片数量"
              >
                <option value={6}>6 张</option>
                <option value={12}>12 张</option>
                <option value={24}>24 张</option>
                <option value={36}>36 张</option>
              </select>
              <ChevronDown size={12} />
            </div>
          </label>
          <label>
            <span>图片格式</span>
            <div className="video-select">
              <select
                value={format}
                onChange={(event) => setFormat(event.target.value as FrameFormat)}
                aria-label="视频截图格式"
              >
                <option value="image/jpeg">JPG · 高清</option>
                <option value="image/png">PNG · 无损</option>
              </select>
              <ChevronDown size={12} />
            </div>
          </label>
          <span className="gallery-original-note">
            <Images size={13} />
            图文作品自动提取原图
          </span>
        </fieldset>
        <p className="video-support-note">
          <ShieldCheck size={12} />
          公开分享页需允许读取；本地视频只在当前浏览器内处理。
        </p>
      </div>
      {error && (
        <div className="video-alert video-error" role="alert">
          <CircleHelp size={17} />
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="关闭提取错误">
            <X size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div className="video-alert video-notice" role="status">
          <Check size={16} />
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="关闭提取提示">
            <X size={15} />
          </button>
        </div>
      )}
      {busy && (
        <div className="video-progress-card" role="status">
          <span className="video-progress-icon">
            <Film size={22} />
          </span>
          <div>
            <strong>{stage}</strong>
            <p>
              {progress === null ? '正在读取内容，请稍候' : `已找到 ${found} 张图片 · ${progress}%`}
            </p>
            <div className={`video-progress-track ${progress === null ? 'indeterminate' : ''}`}>
              <span style={{ width: progress === null ? '35%' : `${progress}%` }} />
            </div>
          </div>
          <button onClick={() => controller.current?.abort()}>取消提取</button>
        </div>
      )}
      {result ? (
        <div className="video-results">
          <div className="video-result-heading">
            <div className="video-result-title">
              <span className="video-success-mark">
                <Check size={18} />
              </span>
              <div>
                <h2 title={result.title}>{result.title}</h2>
                <p>
                  {result.kind === 'gallery' ? '图文原图' : '视频画面'}
                  <i>·</i>
                  {result.pictures.length} 张图片
                  {result.author && (
                    <>
                      <i>·</i>
                      {result.author}
                    </>
                  )}
                  {result.duration !== undefined && (
                    <>
                      <i>·</i>时长 {timestamp(result.duration)}
                    </>
                  )}
                </p>
              </div>
            </div>
            <button
              className="video-download-all"
              disabled={!selected.size || Boolean(downloadProgress)}
              onClick={() => void downloadSelected()}
            >
              {downloadProgress ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Download size={16} />
              )}
              {downloadProgress
                ? `正在下载 ${downloadProgress.done}/${downloadProgress.total}`
                : `批量下载（${selected.size}）`}
            </button>
          </div>
          <div className="video-selection-bar">
            <label>
              <input
                type="checkbox"
                aria-label="全选提取图片"
                checked={selected.size === result.pictures.length}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? new Set(result.pictures.map((item) => item.id))
                      : new Set(),
                  )
                }
              />
              <span>全选</span>
            </label>
            <span>
              已选择 {selected.size} / {result.pictures.length} 张
            </span>
            <span className="video-result-hint">点击图片，放大查看细节</span>
          </div>
          <div className="video-image-grid">
            {result.pictures.map((item) => (
              <article
                className={`video-picture-card ${selected.has(item.id) ? 'picture-selected' : ''}`}
                key={item.id}
              >
                <div className="video-picture-wrap">
                  <button
                    className="video-picture-preview"
                    onClick={() => setPreview(item)}
                    aria-label={`预览图片 ${item.order}`}
                  >
                    <img src={item.url} alt={`提取的图片 ${item.order}`} loading="lazy" />
                    <span>
                      <Expand size={19} />
                    </span>
                  </button>
                  <label className="video-picture-select">
                    <input
                      type="checkbox"
                      aria-label={`选择图片 ${item.order}`}
                      checked={selected.has(item.id)}
                      onChange={() => toggle(item.id)}
                    />
                    <Check size={12} />
                  </label>
                  <span className="video-picture-index">{String(item.order).padStart(2, '0')}</span>
                  {item.time !== undefined && (
                    <span className="video-frame-time">{timestamp(item.time)}</span>
                  )}
                </div>
                <div className="video-picture-info">
                  <span>
                    <b>图片 {item.order}</b>
                    <small>
                      {item.width} × {item.height}
                      <i>·</i>
                      {formatBytes(item.blob.size)}
                    </small>
                  </span>
                  <div>
                    <button
                      className="icon-button"
                      onClick={() => void enhancePicture(item)}
                      aria-label={`增强图片 ${item.order}`}
                      title="继续增强这张图片"
                    >
                      <WandSparkles size={16} />
                    </button>
                    <button
                      className="video-picture-download"
                      onClick={() => download(item)}
                      aria-label={`下载图片 ${item.order}`}
                    >
                      <Download size={14} />
                      <span>下载</span>
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <p className="video-results-footnote">
            提取的图片保留在本次页面中，请及时下载。
            {result.kind === 'video' && '自动去重会跳过相似画面，实际张数可能少于设置数量。'}
          </p>
        </div>
      ) : (
        !busy && (
          <div className="video-empty">
            <div className="video-empty-illustration" aria-hidden="true">
              <div className="video-film-frame">
                <img src="/images/alpine-lake.jpg" alt="" />
                <span>
                  <Play size={22} fill="currentColor" />
                </span>
              </div>
              <div className="video-still-frame">
                <img src="/images/architecture.jpg" alt="" />
                <ImageIcon size={13} />
              </div>
              <span className="video-art-spark">
                <Sparkles size={25} strokeWidth={1.4} />
              </span>
            </div>
            <span className="video-empty-eyebrow">MOMENTS WORTH KEEPING</span>
            <h2>把视频里的好画面，留成图片。</h2>
            <p>
              粘贴分享链接，或选择一个本地视频。
              <br />
              从图文原图到精彩画面，一次提取，轻松带走。
            </p>
            <div className="video-empty-steps">
              <span>
                <b>01</b>粘贴链接
              </span>
              <ArrowRight size={12} />
              <span>
                <b>02</b>提取图片
              </span>
              <ArrowRight size={12} />
              <span>
                <b>03</b>高清下载
              </span>
            </div>
          </div>
        )
      )}
      {preview && (
        <dialog
          ref={dialog}
          className="video-image-modal"
          aria-label={`图片 ${preview.order} 大图预览`}
          onCancel={() => setPreview(null)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setPreview(null)
          }}
        >
          <div className="video-modal-heading">
            <div>
              <strong>图片 {preview.order}</strong>
              <span>
                {preview.width} × {preview.height}
                {preview.time !== undefined ? ` · ${timestamp(preview.time)}` : ''}
              </span>
            </div>
            <button className="video-download-all" onClick={() => download(preview)}>
              <Download size={15} />
              下载这张图片
            </button>
            <button
              className="icon-button"
              onClick={() => setPreview(null)}
              aria-label="关闭图片预览"
            >
              <X size={20} />
            </button>
          </div>
          <div className="video-modal-image">
            <img src={preview.url} alt={`图片 ${preview.order} 大图`} />
          </div>
          <p>
            原始尺寸 {preview.width} × {preview.height} · {formatBytes(preview.blob.size)} ·{' '}
            {result?.title || ''}
          </p>
        </dialog>
      )}
    </section>
  )
}
