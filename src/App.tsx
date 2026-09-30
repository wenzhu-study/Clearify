import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Columns2,
  Download,
  Expand,
  FileImage,
  FolderHeart,
  Image as ImageIcon,
  Leaf,
  LoaderCircle,
  Menu,
  Plus,
  Scan,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react'
import type { EnhanceMode, OutputFormat, SavedImage, SourceImage } from './types'
import { downloadImage, formatBytes, outputSize } from './types'
import { deleteImage, getHistory, saveImage } from './storage'
import Comparison from './Comparison'

const samples = [
  {
    name: '山湖之间',
    category: '自然风景',
    file: '/images/alpine-lake-original.jpg',
    image: '/images/alpine-lake.jpg',
    filename: '山湖之间.jpg',
  },
  {
    name: '美好面孔',
    category: '人像写真',
    file: '/images/portrait.jpg',
    image: '/images/portrait.jpg',
    filename: '美好面孔.jpg',
  },
  {
    name: '光影秩序',
    category: '建筑细节',
    file: '/images/architecture.jpg',
    image: '/images/architecture.jpg',
    filename: '光影秩序.jpg',
  },
]

function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? 'brand-small' : ''}`}>
      <span className="brand-mark">
        <Scan size={27} strokeWidth={1.6} />
        <Sparkles className="brand-spark" size={16} fill="currentColor" />
      </span>
      <span>
        Clearify<span className="brand-dot">.</span>
      </span>
    </div>
  )
}

function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement as HTMLElement | null
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = ''
      previous?.focus()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'modal-wide' : ''}`}
      aria-label={wide ? '全屏图片预览' : title}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="关闭弹窗">
          {wide && <span>退出全屏</span>}
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  )
}

function HistoryCard({
  item,
  onOpen,
  onDelete,
}: {
  item: SavedImage
  onOpen: () => void
  onDelete: () => void
}) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const objectUrl = URL.createObjectURL(item.thumbnail)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [item.thumbnail])
  return (
    <article className="history-card">
      <button className="history-image" onClick={onOpen} aria-label={`查看 ${item.name}`}>
        <img src={url} alt={item.name} />
        <span>
          <Expand size={16} />
          查看对比
        </span>
        <b>{item.scale.toFixed(1).replace('.0', '')}×</b>
      </button>
      <div className="history-info">
        <h3 title={item.name}>{item.name}</h3>
        <p>
          {item.width} × {item.height}
          <span>·</span>
          {formatBytes(item.blob.size)}
        </p>
        <div className="history-actions">
          <time>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</time>
          <button className="icon-button" onClick={onDelete} aria-label={`删除 ${item.name}`}>
            <Trash2 size={16} />
          </button>
          <button
            className="small-download"
            onClick={() => downloadImage(item.blob, item.name, item.format)}
          >
            <Download size={14} />
            下载
          </button>
        </div>
      </div>
    </article>
  )
}

const faqs = [
  {
    question: '图片增强是如何工作的？',
    answer:
      'Clearify 使用高质量 Lanczos 重采样、边缘锐化和可选的轻柔降噪，在放大图片的同时改善细节观感。处理完全在浏览器内完成，不需要 API 密钥。它不会凭空生成已经丢失的细节，严重模糊的照片改善幅度有限。首页风景对比为效果示意；上传并处理后的对比展示你的实际结果。',
  },
  {
    question: '我的照片会被上传或保存到服务器吗？',
    answer:
      '不会。你选择的照片只在当前设备的浏览器内处理。最近的 12 张作品会保存在本地浏览器中（总容量上限约 120 MB），方便再次下载；超出上限时会自动移除较早的记录，你也可以在「我的作品」中删除。清理浏览器站点数据会一并清除这些记录。',
  },
  {
    question: '支持哪些图片格式和尺寸？',
    answer:
      '支持 JPG、PNG 和 WebP，单个文件不超过 20 MB，输入图片不超过 2400 万像素、长边不超过 8000px。为了让浏览器稳定运行，增强结果同样限制在 2400 万像素和 8000px 以内。超大图片的实际放大倍数会适当调整，处理前会显示预计输出尺寸。',
  },
  {
    question: '应该选择 2× 还是 4×？',
    answer:
      '日常照片、社交分享建议先选 2×，处理更快。尺寸较小的图片、需要更大输出的场景可以选择 4×。「自然」模式保留柔和质感；「细节」模式会加强轮廓。噪点较多时建议开启轻柔降噪。',
  },
  {
    question: '下载会收费或添加水印吗？',
    answer:
      '不会。所有增强和下载功能均可免费使用，无需注册，不添加水印。PNG 保留透明背景且无损保存；JPG 文件更小，但透明区域会变为白色；WebP 兼顾体积与透明背景。请及时下载你希望长期保留的图片。',
  },
]

export default function App() {
  const [page, setPage] = useState<'enhance' | 'history'>('enhance')
  const [modal, setModal] = useState<'guide' | 'faq' | 'preview' | null>(null)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [source, setSource] = useState<SourceImage | null>(null)
  const [result, setResult] = useState<SavedImage | null>(null)
  const [resultUrl, setResultUrl] = useState('')
  const [scale, setScale] = useState<2 | 4>(2)
  const [mode, setMode] = useState<EnhanceMode>('natural')
  const [denoise, setDenoise] = useState(true)
  const [format, setFormat] = useState<OutputFormat>('image/png')
  const [view, setView] = useState<'compare' | 'before' | 'after'>('compare')
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [history, setHistory] = useState<SavedImage[]>([])
  const [storageAvailable, setStorageAvailable] = useState(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const previewCard = useRef<HTMLDivElement>(null)
  const worker = useRef<Worker | null>(null)
  const loadingId = useRef(0)
  const dragCounter = useRef(0)

  useEffect(() => {
    getHistory()
      .then(setHistory)
      .catch(() => setStorageAvailable(false))
    return () => worker.current?.terminate()
  }, [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 4800)
    return () => clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    return () => {
      if (source?.url) URL.revokeObjectURL(source.url)
    }
  }, [source?.url])
  useEffect(() => {
    if (!result) {
      setResultUrl('')
      return
    }
    const url = URL.createObjectURL(result.blob)
    setResultUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [result])
  useEffect(() => {
    if (resultUrl && page === 'enhance') {
      previewCard.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
    }
  }, [resultUrl, page])

  const loadFile = useCallback(async (file: Blob, name: string) => {
    if (worker.current) return
    const id = ++loadingId.current
    setError('')
    if (file.size > 20 * 1024 * 1024) {
      setError('这张图片超过了 20 MB，请选择一张小一些的图片。')
      return
    }
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) &&
      !(file.type === '' && /\.(jpe?g|png|webp)$/i.test(name))
    ) {
      setError('暂不支持这种文件，请选择 JPG、PNG 或 WebP 图片。')
      return
    }
    setIsLoading(true)
    let bitmap: ImageBitmap | null = null
    try {
      bitmap = await createImageBitmap(file)
      if (id !== loadingId.current) return
      if (bitmap.width * bitmap.height > 24_000_000 || Math.max(bitmap.width, bitmap.height) > 8000)
        throw new Error('这张图片尺寸过大，请选择 2400 万像素、长边 8000px 以内的图片。')
      setSource({
        file,
        name,
        url: URL.createObjectURL(file),
        width: bitmap.width,
        height: bitmap.height,
      })
      setResult(null)
      setView('compare')
      setPage('enhance')
    } catch (reason) {
      if (id === loadingId.current)
        setError(
          reason instanceof Error && reason.message.startsWith('这张')
            ? reason.message
            : '无法读取这张图片，文件可能已损坏。请重新选择。',
        )
    } finally {
      bitmap?.close()
      if (id === loadingId.current) setIsLoading(false)
    }
  }, [])

  const loadSample = async (index: number) => {
    if (isProcessing || isLoading) return
    setIsLoading(true)
    setError('')
    try {
      const response = await fetch(samples[index].file)
      if (!response.ok) throw new Error('sample')
      await loadFile(await response.blob(), samples[index].filename)
    } catch {
      setError('示例暂时无法读取，请上传自己的图片试试。')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (modal || isProcessing || isLoading) return
      const image = Array.from(event.clipboardData?.files ?? []).find((file) =>
        file.type.startsWith('image/'),
      )
      if (image) {
        event.preventDefault()
        void loadFile(image, image.name || '粘贴的图片.png')
      }
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  }, [loadFile, modal, isProcessing, isLoading])

  const enhance = () => {
    if (!source) {
      fileInput.current?.click()
      return
    }
    if (isProcessing || isLoading) return
    if (!('Worker' in window) || !('OffscreenCanvas' in window)) {
      setError('当前浏览器暂不支持本地增强，请使用新版 Chrome、Edge 或 Safari。')
      return
    }
    setError('')
    setProgress(0)
    setProgressMessage('准备让画面焕然一新…')
    setIsProcessing(true)
    const currentSource = source
    try {
      const processingWorker = new Worker(new URL('./enhance.worker.ts', import.meta.url), {
        type: 'module',
      })
      worker.current = processingWorker
      const finish = () => {
        processingWorker.terminate()
        worker.current = null
        setIsProcessing(false)
      }
      processingWorker.onmessage = async (event) => {
        const data = event.data
        if (data.type === 'progress') {
          setProgress(data.progress)
          setProgressMessage(data.message)
          return
        }
        if (data.type === 'error') {
          setError(data.message)
          finish()
          return
        }
        if (data.type === 'done') {
          const saved: SavedImage = {
            id: crypto.randomUUID(),
            name: currentSource.name,
            createdAt: Date.now(),
            width: data.width,
            height: data.height,
            originalWidth: currentSource.width,
            originalHeight: currentSource.height,
            scale: data.width / currentSource.width,
            format: data.format,
            blob: data.blob,
            original: currentSource.file,
            thumbnail: data.thumbnail,
          }
          setResult(saved)
          setView('compare')
          setProgress(100)
          finish()
          setToast('画面已焕新，高清图片可以下载了')
          try {
            await saveImage(saved)
            setHistory(await getHistory())
          } catch {
            setStorageAvailable(false)
            setToast('增强已完成。本地保存不可用，请直接下载图片。')
          }
        }
      }
      processingWorker.onerror = () => {
        setError('处理时遇到问题，可能是图片占用内存较大。请尝试 2× 或更小的图片。')
        finish()
      }
      processingWorker.postMessage({ file: source.file, options: { scale, mode, denoise, format } })
    } catch {
      worker.current?.terminate()
      worker.current = null
      setIsProcessing(false)
      setError('图片处理未能启动，请刷新后重试。')
    }
  }

  const cancel = () => {
    worker.current?.terminate()
    worker.current = null
    setIsProcessing(false)
    setProgress(0)
    setToast('已取消处理，你可以调整设置后重新开始')
  }
  const reset = () => {
    if (isProcessing) return
    loadingId.current++
    setSource(null)
    setResult(null)
    setError('')
    setView('compare')
    setIsLoading(false)
  }
  const switchPage = (next: 'enhance' | 'history') => {
    setPage(next)
    setMobileMenu(false)
  }
  const changeOptions = (action: () => void) => {
    action()
    setResult(null)
    setView('compare')
  }
  const openHistory = (item: SavedImage) => {
    if (isProcessing) {
      setToast('请等待当前图片处理完成')
      return
    }
    loadingId.current++
    setSource({
      file: item.original,
      name: item.name,
      url: URL.createObjectURL(item.original),
      width: item.originalWidth,
      height: item.originalHeight,
    })
    setResult(item)
    setFormat(item.format)
    setScale(item.scale > 2 ? 4 : 2)
    setView('compare')
    setError('')
    switchPage('enhance')
  }
  const removeHistory = async (id: string) => {
    try {
      await deleteImage(id)
      setHistory((items) => items.filter((item) => item.id !== id))
      setToast('已从本地作品中移除')
    } catch {
      setToast('暂时无法删除，请重试')
    }
  }
  const predicted = source ? outputSize(source.width, source.height, scale) : null
  const previewSource = source?.url || '/images/alpine-lake-original.jpg'
  const previewResult = source ? resultUrl : '/images/alpine-lake.jpg'
  const previewWidth = result?.width ?? source?.width ?? 1600
  const previewHeight = result?.height ?? source?.height ?? 1067
  const busy = isProcessing || isLoading

  return (
    <div className="app-shell">
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="上传图片文件"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void loadFile(file, file.name)
          event.target.value = ''
        }}
      />
      {mobileMenu && (
        <button
          className="mobile-scrim"
          aria-label="关闭导航"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
        <a
          className="brand-link"
          href="#"
          onClick={(event) => {
            event.preventDefault()
            switchPage('enhance')
          }}
          aria-label="Clearify 首页"
        >
          <Brand small />
        </a>
        <nav className="main-nav" aria-label="主导航">
          <button
            className={`nav-item ${page === 'enhance' ? 'active' : ''}`}
            onClick={() => switchPage('enhance')}
          >
            <WandSparkles size={19} />
            <span>图片增强</span>
            <span className="nav-active-dot" />
          </button>
          <button
            className={`nav-item ${page === 'history' ? 'active' : ''}`}
            onClick={() => switchPage('history')}
          >
            <FolderHeart size={19} />
            <span>我的作品</span>
            {history.length > 0 && <span className="nav-count">{history.length}</span>}
          </button>
        </nav>
        <div className="nav-divider" />
        <nav className="main-nav support-nav" aria-label="帮助导航">
          <button
            className="nav-item"
            onClick={() => {
              setModal('guide')
              setMobileMenu(false)
            }}
          >
            <BookOpen size={18} />
            <span>使用指南</span>
            <ArrowUpRight size={14} className="nav-end-icon" />
          </button>
          <button
            className="nav-item"
            onClick={() => {
              setModal('faq')
              setMobileMenu(false)
            }}
          >
            <CircleHelp size={18} />
            <span>常见问题</span>
          </button>
        </nav>
      </aside>

      <div className="main-shell">
        <main
          className={`main-content studio-content ${page === 'enhance' ? 'enhance-content' : 'history-content'}`}
        >
          <div className="studio-heading">
            <button
              className="icon-button mobile-menu-button"
              onClick={() => setMobileMenu(true)}
              aria-label="打开导航"
            >
              <Menu size={21} />
            </button>
            <div className="studio-heading-text">
              <h1>{page === 'enhance' ? '图片高清增强' : '我的作品'}</h1>
              <p>
                {page === 'enhance'
                  ? '让每一处细节，都清晰出彩。'
                  : '那些值得保留的细节，都在这里。'}
              </p>
            </div>
            {page === 'enhance' && (
              <div className="studio-samples" aria-label="示例图片">
                <span>试试示例</span>
                {samples.map((sample, index) => (
                  <button
                    key={sample.name}
                    className={`studio-sample ${source?.name === sample.filename ? 'sample-selected' : ''}`}
                    disabled={busy}
                    onClick={() => void loadSample(index)}
                    aria-label={`使用${sample.category}示例`}
                    title={sample.name}
                  >
                    <img src={sample.image} alt="" />
                    <span>{sample.category}</span>
                    <ArrowUpRight size={12} />
                  </button>
                ))}
              </div>
            )}
          </div>
          {page === 'enhance' ? (
            <>
              <section className="workspace" aria-label="图片增强工作台">
                <div className="preview-column">
                  <div className="preview-card" ref={previewCard}>
                    <div className="card-heading">
                      <div className="preview-title">
                        <ScanLine size={17} />
                        <h2>效果预览</h2>
                        {!source && <span className="demo-badge">效果示意</span>}
                        {result && (
                          <span className="completed-badge">
                            <Check size={11} />
                            已完成
                          </span>
                        )}
                      </div>
                      <div className="preview-tools">
                        <div className="view-toggle">
                          <button
                            className={view === 'compare' ? 'selected' : ''}
                            onClick={() => setView('compare')}
                            title="对比视图"
                            aria-label="对比视图"
                            aria-pressed={view === 'compare'}
                          >
                            <Columns2 size={14} />
                            <span>对比</span>
                          </button>
                          <button
                            className={view === 'before' ? 'selected' : ''}
                            onClick={() => setView('before')}
                            title="原图视图"
                            aria-label="原图视图"
                            aria-pressed={view === 'before'}
                          >
                            <ImageIcon size={14} />
                            <span>原图</span>
                          </button>
                          <button
                            className={view === 'after' ? 'selected' : ''}
                            disabled={Boolean(source && !result)}
                            onClick={() => setView('after')}
                            title="增强效果视图"
                            aria-label="增强效果视图"
                            aria-pressed={view === 'after'}
                          >
                            <Sparkles size={14} />
                            <span>增强后</span>
                          </button>
                        </div>
                        <button
                          className="expand-button"
                          onClick={() => setModal('preview')}
                          aria-label="放大查看图片"
                        >
                          <Expand size={16} />
                          <span>全屏预览</span>
                        </button>
                      </div>
                    </div>
                    <div className="preview-image-wrap">
                      <Comparison
                        key={source?.url || 'demo'}
                        source={previewSource}
                        result={previewResult}
                        demo={!source}
                        mode={view}
                        width={previewWidth}
                        height={previewHeight}
                        metadata={
                          <div className="preview-caption">
                            {source ? (
                              <>
                                <span>
                                  <FileImage size={13} />
                                  {source.width} × {source.height}
                                </span>
                                <ArrowRight size={14} />
                                <span className={result ? 'result-dimensions' : ''}>
                                  {result ? `${result.width} × ${result.height}` : '等待增强'}
                                </span>
                                <span className="preview-caption-end">
                                  {result
                                    ? formatBytes(result.blob.size)
                                    : formatBytes(source.file.size)}
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="preview-caption-note">
                                  <span className="tiny-orange-dot" />
                                  细节之美，一览无余
                                </span>
                                <span className="preview-caption-end">
                                  每一处细节，都值得被看见
                                </span>
                              </>
                            )}
                          </div>
                        }
                      />
                      {isProcessing && (
                        <div className="processing-overlay">
                          <div className="processing-orb">
                            <Sparkles size={29} />
                          </div>
                          <h3>让清晰，一点点发生</h3>
                          <p>{progressMessage}</p>
                          <div className="processing-track">
                            <span style={{ width: `${progress}%` }} />
                          </div>
                          <span className="processing-percent">{progress}%</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="control-card" id="enhance-controls">
                  <div className="control-upload">
                    <div
                      className={`upload-zone ${isDragging ? 'is-dragging' : ''} ${source ? 'has-source' : ''}`}
                      onDragEnter={(event) => {
                        event.preventDefault()
                        if (busy) return
                        dragCounter.current++
                        setIsDragging(true)
                      }}
                      onDragOver={(event) => {
                        event.preventDefault()
                        event.dataTransfer.dropEffect = busy ? 'none' : 'copy'
                      }}
                      onDragLeave={(event) => {
                        event.preventDefault()
                        dragCounter.current--
                        if (dragCounter.current <= 0) setIsDragging(false)
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        dragCounter.current = 0
                        setIsDragging(false)
                        if (busy) return
                        const files = event.dataTransfer.files
                        if (files.length > 1) {
                          setError('一次处理一张就好，请拖入单张图片。')
                          return
                        }
                        if (files[0]) void loadFile(files[0], files[0].name)
                      }}
                    >
                      {source ? (
                        <>
                          <div className="selected-file">
                            <img src={source.url} alt="已选择的图片" />
                            <div>
                              <strong title={source.name}>{source.name}</strong>
                              <span>
                                {source.width} × {source.height} · {formatBytes(source.file.size)}
                              </span>
                            </div>
                            <button
                              className="icon-button remove-file"
                              disabled={busy}
                              onClick={reset}
                              aria-label="移除图片"
                            >
                              <X size={15} />
                            </button>
                          </div>
                          <button
                            className="replace-file"
                            disabled={busy}
                            onClick={() => fileInput.current?.click()}
                          >
                            <Upload size={13} />
                            更换
                          </button>
                        </>
                      ) : (
                        <button
                          className="upload-button"
                          disabled={busy}
                          onClick={() => fileInput.current?.click()}
                        >
                          <span className="upload-icon">
                            {isLoading ? (
                              <LoaderCircle size={25} className="spin" />
                            ) : (
                              <Upload size={24} strokeWidth={1.6} />
                            )}
                            <span>
                              <Plus size={10} strokeWidth={3} />
                            </span>
                          </span>
                          <span className="upload-primary">
                            <b>点击上传</b> 或拖拽图片到这里
                          </span>
                          <span className="upload-secondary">JPG、PNG、WebP · 最大 20 MB</span>
                        </button>
                      )}
                    </div>
                    {error && (
                      <div className="error-message" role="alert">
                        <CircleHelp size={15} />
                        <span>{error}</span>
                        <button onClick={() => setError('')} aria-label="关闭错误提示">
                          <X size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                  <fieldset className="enhance-settings" disabled={busy} aria-label="图片增强设置">
                    <div className="setting-group setting-scale">
                      <div className="setting-label">
                        <span>放大倍数</span>
                      </div>
                      <div className="scale-options" role="group" aria-label="放大倍数">
                        {([2, 4] as const).map((value) => (
                          <button
                            key={value}
                            className={scale === value ? 'option-selected' : ''}
                            onClick={() => changeOptions(() => setScale(value))}
                            aria-pressed={scale === value}
                            aria-label={`${value} 倍放大`}
                          >
                            {value}×{value === 4 && <span className="scale-hd">HD</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="setting-group setting-mode">
                      <div className="setting-label">
                        <span>增强风格</span>
                      </div>
                      <div className="mode-options" role="group" aria-label="增强模式">
                        <button
                          className={mode === 'natural' ? 'mode-selected' : ''}
                          onClick={() => changeOptions(() => setMode('natural'))}
                          aria-pressed={mode === 'natural'}
                        >
                          <Leaf size={13} />
                          自然
                        </button>
                        <button
                          className={mode === 'detail' ? 'mode-selected' : ''}
                          onClick={() => changeOptions(() => setMode('detail'))}
                          aria-pressed={mode === 'detail'}
                        >
                          <ScanLine size={13} />
                          细节
                        </button>
                      </div>
                    </div>
                    <div className="setting-group setting-noise">
                      <div className="setting-label">
                        <label htmlFor="denoise-switch">轻柔降噪</label>
                      </div>
                      <div className="noise-control">
                        <button
                          id="denoise-switch"
                          className={`switch ${denoise ? 'switch-on' : ''}`}
                          role="switch"
                          aria-checked={denoise}
                          aria-label="轻柔降噪"
                          onClick={() => changeOptions(() => setDenoise(!denoise))}
                        >
                          <span />
                        </button>
                        <span>{denoise ? '开启' : '关闭'}</span>
                      </div>
                    </div>
                    <div className="setting-group setting-format">
                      <div className="setting-label">
                        <label htmlFor="output-format">下载格式</label>
                      </div>
                      <div className="select-wrapper">
                        <select
                          id="output-format"
                          value={format}
                          onChange={(event) =>
                            changeOptions(() => setFormat(event.target.value as OutputFormat))
                          }
                        >
                          <option value="image/png">PNG · 无损</option>
                          <option value="image/jpeg">JPG · 轻量</option>
                          <option value="image/webp">WebP · 高清</option>
                        </select>
                        <ChevronDown size={13} />
                      </div>
                    </div>
                  </fieldset>
                  <div className="control-export">
                    {predicted && (
                      <p className={`output-estimate ${predicted.limited ? 'size-limited' : ''}`}>
                        {predicted.limited ? '已按尺寸上限调整：' : '预计输出：'}
                        <b>
                          {predicted.width} × {predicted.height}
                        </b>{' '}
                        px
                      </p>
                    )}
                    <div className="primary-action">
                      {isProcessing ? (
                        <>
                          <button className="enhance-button processing-button" disabled>
                            <LoaderCircle size={18} className="spin" />
                            <span>正在增强</span>
                            <span>{progress}%</span>
                          </button>
                          <button className="cancel-button" onClick={cancel}>
                            取消处理
                          </button>
                        </>
                      ) : result ? (
                        <>
                          <button
                            className="enhance-button download-button"
                            onClick={() => {
                              downloadImage(result.blob, result.name, result.format)
                              setToast('高清图片已准备下载')
                            }}
                          >
                            <Download size={18} />
                            <span>下载高清图片</span>
                            <span className="button-end">{formatBytes(result.blob.size)}</span>
                          </button>
                          <button className="cancel-button" onClick={enhance}>
                            重新增强
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="enhance-button" disabled={isLoading} onClick={enhance}>
                            {isLoading ? (
                              <LoaderCircle size={18} className="spin" />
                            ) : (
                              <Sparkles size={18} />
                            )}
                            <span>{isLoading ? '正在读取图片' : '一键变清晰'}</span>
                            <ArrowRight size={17} className="button-end" />
                          </button>
                          <p className="action-note">
                            <ShieldCheck size={12} />
                            无需注册<span>·</span>无水印<span>·</span>免费使用
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <>
              <div className="history-toolbar">
                <h2>
                  最近处理 <span>{history.length}</span>
                </h2>
                <button className="text-button" onClick={() => switchPage('enhance')}>
                  <Plus size={15} />
                  增强新图片
                </button>
              </div>
              {!storageAvailable && (
                <p className="storage-warning">
                  <CircleHelp size={16} />
                  浏览器本地存储暂不可用。增强后仍可直接下载图片。
                </p>
              )}
              {history.length ? (
                <div className="history-grid">
                  {history.map((item) => (
                    <HistoryCard
                      key={item.id}
                      item={item}
                      onOpen={() => openHistory(item)}
                      onDelete={() => void removeHistory(item.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-history">
                  <div className="empty-history-icon">
                    <FolderHeart size={38} strokeWidth={1.2} />
                    <Sparkles size={18} />
                  </div>
                  <h2>下一张清晰好图，从这里开始</h2>
                  <p>增强后的作品会自动保存在这里，方便你随时查看和下载。</p>
                  <button
                    className="enhance-button"
                    onClick={() => {
                      switchPage('enhance')
                      fileInput.current?.click()
                    }}
                  >
                    <Plus size={17} />
                    上传第一张图片
                    <ArrowRight size={16} />
                  </button>
                </div>
              )}
              {history.length > 0 && (
                <p className="history-footnote">
                  <ShieldCheck size={13} />
                  保留最近 12 张作品，总容量约 120 MB。清理浏览器数据会清除记录，请及时下载。
                </p>
              )}
            </>
          )}
          <footer className="footer">
            <span>© {new Date().getFullYear()} Clearify</span>
            <span>
              {page === 'enhance'
                ? '拖动竖线比较 · 放大后拖动画面查看细节'
                : '作品保存在当前浏览器中'}
            </span>
          </footer>
        </main>
      </div>

      {toast && (
        <div className="toast" role="status">
          <span>
            <Check size={13} />
          </span>
          {toast}
          <button onClick={() => setToast('')} aria-label="关闭提示">
            <X size={14} />
          </button>
        </div>
      )}
      {modal === 'preview' && (
        <Dialog title={source?.name || '清晰，眼见为实'} wide onClose={() => setModal(null)}>
          <div className="fullscreen-controls">
            <div className="view-toggle">
              {(
                [
                  ['compare', '前后对比'],
                  ['before', '原始图片'],
                  ['after', '增强效果'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={view === value ? 'selected' : ''}
                  aria-pressed={view === value}
                  disabled={value === 'after' && Boolean(source && !result)}
                  onClick={() => setView(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="fullscreen-title-note">把每一个细节，看得更清楚</span>
            {result && (
              <button
                className="preview-quick-action"
                onClick={() => downloadImage(result.blob, result.name, result.format)}
              >
                <Download size={15} />
                下载当前图片
              </button>
            )}
          </div>
          <Comparison
            source={previewSource}
            result={previewResult}
            demo={!source}
            mode={view}
            width={previewWidth}
            height={previewHeight}
            large
          />
          <p className="modal-preview-note">
            {result
              ? `${source?.width} × ${source?.height} → ${result.width} × ${result.height}`
              : source
                ? '原始图片 · 点击一键变清晰，查看增强效果'
                : '效果示意 · 上传自己的图片，发现更多细节'}
          </p>
        </Dialog>
      )}
      {modal === 'guide' && (
        <Dialog title="三步，让清晰发生" onClose={() => setModal(null)}>
          <p className="modal-intro">不需要复杂的参数，每个人都能轻松拥有好画质。</p>
          <div className="guide-steps">
            {[
              {
                icon: Upload,
                title: '上传一张值得留住的照片',
                text: '点击上传、拖入图片，或直接粘贴。支持 JPG、PNG 和 WebP，最大 20 MB。',
              },
              {
                icon: SlidersHorizontal,
                title: '选择喜欢的清晰程度',
                text: '选择 2× 或 4× 放大，根据照片选择自然或细节模式，再点击「一键变清晰」。',
              },
              {
                icon: Download,
                title: '看见改变，带走美好',
                text: '在大图中拖动分隔线比较前后细节，支持 100% 实际像素、200%、400% 放大和拖动平移。点击「全屏预览」铺满窗口，满意后下载高清图片。',
              },
            ].map((step, index) => (
              <div className="guide-step" key={step.title}>
                <span className="guide-step-icon">
                  <step.icon size={21} />
                </span>
                <div>
                  <span className="guide-number">0{index + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              </div>
            ))}
          </div>
          <button
            className="enhance-button guide-action"
            onClick={() => {
              setModal(null)
              switchPage('enhance')
              fileInput.current?.click()
            }}
          >
            <Sparkles size={17} />
            开始我的第一次增强
            <ArrowRight size={17} />
          </button>
          <p className="modal-privacy">
            <ShieldCheck size={13} />
            每一次处理，都只发生在你的设备上。
          </p>
        </Dialog>
      )}
      {modal === 'faq' && (
        <Dialog title="你可能想知道" onClose={() => setModal(null)}>
          <p className="modal-intro">关于画质、隐私，以及每一个小细节。</p>
          <div className="faq-list">
            {faqs.map((faq, index) => (
              <details key={faq.question} open={index === 0}>
                <summary>
                  {faq.question}
                  <Plus size={17} />
                </summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
          <div className="faq-bottom">
            <Leaf size={17} />
            <span>简单、私密、免费。让好画质回归日常。</span>
          </div>
        </Dialog>
      )}
    </div>
  )
}
