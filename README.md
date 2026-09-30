# Clearify

一个注重质感和隐私的中文图片高清增强工具。暖白与陶橙色工作台，支持桌面和手机。

## 运行

需要 Node.js 22.12+。

```sh
npm install
npm run dev
```

打开终端显示的本地网址，默认是 `http://localhost:5173`。

```sh
npm run build   # 类型检查并生成 dist/
npm run preview # 预览生产构建
npm test        # 运行浏览器端到端测试，默认使用本机 Chrome
```

`dist/` 可以部署到任意静态网站托管服务。生产环境请使用 HTTPS，以支持 Worker、本地存储等浏览器能力。无需后端、数据库服务或 API 密钥。

## 已实现

- 上传、拖拽、粘贴 JPG / PNG / WebP，文件和尺寸校验。
- 2× / 4× 放大，自然 / 细节模式，可选轻柔降噪。
- 在 Web Worker 中运行实际的 Lanczos 3 重采样、边缘锐化和降噪；显示真实阶段进度，支持取消。
- 紧凑侧栏、整屏图片工作台和底部操作区：大图、上传、参数与下载集中在同一视野中，手机端自动调整为纵向布局。
- 增强完成自动回到大图对比，以至少 100% 实际像素显示细节（小图会适当放大）。
- 铺满窗口的全屏预览，支持适应窗口、100% 实际像素、200% / 400% 细节缩放和拖动平移。原图与增强图同步移动和缩放，便于查看同一区域。
- 拖动分隔线比较前后效果，也可切换原图 / 增强图。全屏内用滚轮缩放，页面内用 Ctrl / ⌘ + 滚轮；双击切换放大 / 适应，键盘 `+` / `-` 缩放、`0` 复位、方向键平移，`Esc` 退出全屏。
- 高清 PNG、JPG、WebP 下载；PNG / WebP 保留透明背景，JPG 用白色填充透明区域。
- IndexedDB 本地作品记录，可查看、再次下载和删除。保留最近 12 张，总容量约 120 MB。
- 3 张可操作的示例图片、使用指南、常见问题和移动端导航。
- 字体与示例图片随站点托管，处理用户照片时不请求第三方服务。

## 处理说明

这是无需模型下载的**本地传统图像增强算法**，不是生成式 AI 超分辨率。它改善放大质量和边缘清晰度，但不能恢复照片中已经丢失的真实细节。首页初始风景对比是明确标注的效果示意；用户上传或选择示例后，处理及对比都使用真实算法结果。

单文件最大 20 MB，输入与输出均限制在 2400 万像素、长边 8000px 以内。超过输出上限时按比例调整，并在增强前显示实际预计尺寸。处理大图会使用更多内存和时间，设备性能会影响速度。

建议使用支持 OffscreenCanvas、createImageBitmap 和 Web Worker 的新版 Chrome、Edge、Firefox 或 Safari。测试配置使用本机 Chrome；其他环境可安装 Playwright Chromium，并移除 `playwright.config.ts` 中的 `channel: 'chrome'`。

## 结构

- `src/App.tsx`：界面、交互与工作流。
- `src/Comparison.tsx`：可缩放、平移的同步图片对比。
- `src/studio.css`：工作台布局、紧凑导航、底部操作区和全屏预览。
- `src/styles.css`：视觉样式和响应式布局。
- `src/enhance.worker.ts`：独立线程中的图像算法。
- `src/storage.ts`：作品的本地持久化。
- `src/types.ts`：类型、输出尺寸计算与下载。
- `tests/e2e.spec.ts`：实际上传、下载、透明通道、格式、作品记录、取消、错误与移动端测试。

## 素材

示例照片来自 [Unsplash](https://unsplash.com)，保存在 `public/images/`：

- [山湖风景](https://images.unsplash.com/photo-1470770841072-f978cf4d019e)
- [人像](https://images.unsplash.com/photo-1534528741775-53994a69daeb)
- [建筑](https://images.unsplash.com/photo-1511818966892-d7d671e672a2)

字体为 DM Sans（SIL Open Font License，见 `public/fonts/OFL.txt`），图标使用 Lucide。
