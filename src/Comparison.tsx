import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import {
  ChevronsLeftRight,
  Hand,
  Maximize,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
  WandSparkles,
} from 'lucide-react'

type Point = { x: number; y: number }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export default function Comparison({
  source,
  result,
  demo,
  mode,
  width,
  height,
  large = false,
  metadata,
}: {
  source: string
  result: string
  demo: boolean
  mode: 'compare' | 'before' | 'after'
  width: number
  height: number
  large?: boolean
  metadata?: ReactNode
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const gesture = useRef<{
    type: 'pan' | 'compare'
    pointer: number
    start: Point
    offset: Point
  } | null>(null)
  const [size, setSize] = useState({ width: 1, height: 1 })
  const [position, setPosition] = useState(50)
  const [zoom, setZoom] = useState<number | 'detail' | null>(result && !demo ? 'detail' : null)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const fitScale = Math.min(size.width / width, size.height / height)
  // Show completed images at actual pixels or larger, so fine detail is visible immediately.
  const imageScale = zoom === 'detail' ? Math.max(1, fitScale) : (zoom ?? fitScale)
  const fitted = zoom === null || (zoom === 'detail' && fitScale >= 1)
  const minScale = Math.min(0.125, fitScale)
  const maxScale = Math.max(8, fitScale)
  const compare = mode === 'compare' && Boolean(result)
  const canPan = width * imageScale > size.width + 1 || height * imageScale > size.height + 1

  const boundOffset = useCallback(
    (point: Point, scale: number): Point => {
      const maxX = Math.max(0, (width * scale - size.width) / 2)
      const maxY = Math.max(0, (height * scale - size.height) / 2)
      return { x: clamp(point.x, -maxX, maxX), y: clamp(point.y, -maxY, maxY) }
    },
    [width, height, size],
  )

  useEffect(() => {
    const element = viewport.current!
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setZoom(result && !demo ? 'detail' : null)
    setOffset({ x: 0, y: 0 })
  }, [source, result, width, height, demo])

  useEffect(() => {
    setOffset((previous) => boundOffset(previous, imageScale))
  }, [boundOffset, imageScale])

  const changeZoom = useCallback(
    (nextZoom: number | null, anchor: Point = { x: 0, y: 0 }) => {
      const next = nextZoom === null ? fitScale : clamp(nextZoom, minScale, maxScale)
      setOffset((previous) =>
        nextZoom === null
          ? { x: 0, y: 0 }
          : boundOffset(
              {
                x: anchor.x - ((anchor.x - previous.x) * next) / imageScale,
                y: anchor.y - ((anchor.y - previous.y) * next) / imageScale,
              },
              next,
            ),
      )
      setZoom(nextZoom === null ? null : next)
    },
    [fitScale, minScale, maxScale, imageScale, boundOffset],
  )

  useEffect(() => {
    const element = viewport.current!
    const onWheel = (event: WheelEvent) => {
      // Leave normal page scrolling available outside the immersive preview.
      if (!large && !event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1)
      changeZoom(imageScale * Math.exp(-clamp(delta, -180, 180) * 0.003), {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      })
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [changeZoom, imageScale, large])

  const moveDivider = (clientX: number) => {
    const rect = viewport.current!.getBoundingClientRect()
    setPosition(clamp(Math.round(((clientX - rect.left) / rect.width) * 100), 0, 100))
  }

  const startGesture = (event: ReactPointerEvent<HTMLDivElement>, type: 'pan' | 'compare') => {
    if (event.button !== 0 || gesture.current || (type === 'pan' && !canPan)) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = {
      type,
      pointer: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      offset,
    }
    setDragging(type === 'pan')
    if (type === 'compare') moveDivider(event.clientX)
  }

  const moveGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    event.stopPropagation()
    if (active.type === 'compare') moveDivider(event.clientX)
    else
      setOffset(
        boundOffset(
          {
            x: active.offset.x + event.clientX - active.start.x,
            y: active.offset.y + event.clientY - active.start.y,
          },
          imageScale,
        ),
      )
  }

  const stopGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gesture.current?.pointer !== event.pointerId) return
    event.stopPropagation()
    gesture.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const imageStyle: CSSProperties = {
    width: width * imageScale,
    height: height * imageScale,
    transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
  }

  return (
    <div className={`preview-viewer ${large ? 'preview-viewer-large' : ''}`}>
      <div
        ref={viewport}
        className={`comparison ${demo ? 'is-demo' : 'is-upload'} ${canPan ? 'is-pannable' : ''} ${dragging ? 'is-panning' : ''}`}
        tabIndex={0}
        role="region"
        aria-label={large ? '全屏图片画布' : '图片预览画布'}
        aria-describedby={large ? 'fullscreen-viewer-help' : 'viewer-help'}
        onPointerDown={(event) => startGesture(event, 'pan')}
        onPointerMove={moveGesture}
        onPointerUp={stopGesture}
        onPointerCancel={stopGesture}
        onLostPointerCapture={() => {
          gesture.current = null
          setDragging(false)
        }}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('[role="slider"]')) return
          changeZoom(zoom === null ? Math.max(1, fitScale * 2) : null)
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          const key = event.key
          if (key === '+' || key === '=') {
            event.preventDefault()
            changeZoom(imageScale * 1.5)
          } else if (key === '-') {
            event.preventDefault()
            changeZoom(imageScale / 1.5)
          } else if (key === '0') {
            event.preventDefault()
            changeZoom(null)
          } else if (key.startsWith('Arrow') && canPan) {
            event.preventDefault()
            setOffset((previous) =>
              boundOffset(
                {
                  x: previous.x + (key === 'ArrowLeft' ? 60 : key === 'ArrowRight' ? -60 : 0),
                  y: previous.y + (key === 'ArrowUp' ? 60 : key === 'ArrowDown' ? -60 : 0),
                },
                imageScale,
              ),
            )
          }
        }}
      >
        <img
          className="compare-image"
          style={imageStyle}
          src={mode === 'before' || !result ? source : result}
          alt={mode === 'before' || !result ? '原始图片' : '高清增强图片'}
          draggable="false"
        />
        {compare && (
          <div className="before-layer" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
            <img
              className={`compare-image ${demo ? 'demo-original' : ''}`}
              style={imageStyle}
              src={source}
              alt="增强前的图片"
              draggable="false"
            />
          </div>
        )}
        <div className="preview-labels">
          {(compare || mode === 'before' || !result) && (
            <span className="image-label label-before">
              <span className="label-dot" />
              {demo ? '原始画质' : '原始图片'}
            </span>
          )}
          {(compare || mode === 'after') && result && (
            <span className="image-label label-after">
              <Sparkles size={13} />
              {demo ? '高清效果' : '增强完成'}
            </span>
          )}
        </div>
        {compare && (
          <div
            className="comparison-divider"
            style={{ left: `clamp(2px, ${position}%, calc(100% - 2px))` }}
            role="slider"
            tabIndex={0}
            aria-label={large ? '全屏对比位置' : '拖动查看增强前后对比'}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={position}
            aria-valuetext={`原图 ${position}%，增强图 ${100 - position}%`}
            aria-orientation="horizontal"
            onPointerDown={(event) => startGesture(event, 'compare')}
            onPointerMove={moveGesture}
            onPointerUp={stopGesture}
            onPointerCancel={stopGesture}
            onKeyDown={(event) => {
              const values: Record<string, number> = {
                ArrowLeft: position - 2,
                ArrowDown: position - 2,
                ArrowRight: position + 2,
                ArrowUp: position + 2,
                PageDown: position - 10,
                PageUp: position + 10,
                Home: 0,
                End: 100,
              }
              if (event.key in values) {
                event.preventDefault()
                event.stopPropagation()
                setPosition(clamp(values[event.key], 0, 100))
              }
            }}
          >
            <span className="comparison-grip">
              <ChevronsLeftRight size={21} strokeWidth={1.8} />
            </span>
          </div>
        )}
        {!result && (
          <span className="waiting-label">
            <WandSparkles size={14} />
            已就绪，等待焕新
          </span>
        )}
      </div>
      <div className="viewer-toolbar" aria-label={large ? '全屏缩放工具' : '预览缩放工具'}>
        <div className="zoom-controls">
          <button
            className={fitted ? 'zoom-selected' : ''}
            onClick={() => changeZoom(null)}
            aria-pressed={fitted}
            title="显示整张图片，快捷键 0"
          >
            <Maximize size={14} />
            <span>适应窗口</span>
          </button>
          <span className="zoom-separator" />
          <button
            className="zoom-icon"
            onClick={() => changeZoom(imageScale / 1.5)}
            disabled={imageScale <= minScale + 0.001}
            aria-label="缩小预览"
          >
            <Minus size={15} />
          </button>
          <output aria-label="当前预览缩放" className="zoom-value">
            {Math.round(imageScale * 100)}%
          </output>
          <button
            className="zoom-icon"
            onClick={() => changeZoom(imageScale * 1.5)}
            disabled={imageScale >= maxScale - 0.001}
            aria-label="放大预览"
          >
            <Plus size={15} />
          </button>
          <span className="zoom-separator" />
          {[1, 2, 4].map((value) => (
            <button
              key={value}
              className={!fitted && imageScale === value ? 'zoom-selected' : ''}
              onClick={() => changeZoom(value)}
              aria-pressed={!fitted && imageScale === value}
              aria-label={value === 1 ? '100% 实际像素' : `${value * 100}% 预览缩放`}
              title={value === 1 ? '一个图片像素对应一个屏幕像素' : `以 ${value * 100}% 查看细节`}
            >
              {value * 100}%
            </button>
          ))}
          <button
            className="zoom-icon reset-preview"
            onClick={() => {
              changeZoom(null)
              setPosition(50)
            }}
            aria-label="重置预览"
            title="重置缩放、位置和对比线"
          >
            <RotateCcw size={14} />
          </button>
        </div>
        <p className="viewer-help" id={large ? 'fullscreen-viewer-help' : 'viewer-help'}>
          <Hand size={13} />
          <span>
            {large ? '滚轮缩放' : 'Ctrl / ⌘ + 滚轮缩放'}
            <i>·</i>放大后拖动画面<i>·</i>拖动竖线对比
          </span>
        </p>
        {metadata}
      </div>
    </div>
  )
}
