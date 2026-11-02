# 本地素材（不入库）

`lib/assets/` 里的人物视频、海报与图层是**本地可选素材**，默认不随仓库或官方
Release 分发（原因见根目录 [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md)）。

官方包没有它们时，插件仍会完整走降级链：启动层改用静帧/无视频分支继续时间轴，
HUD、交接转场、程序化音轨、四档皮肤与全部设置项不受影响，**不报错、不中断**。

## 文件清单

| 文件 | 必需 | 说明 |
|---|---|---|
| `hero-loop.mp4` | 否（首选） | 1920×1080 / 6.000s / 24fps / H.264 / yuv420p / 无音轨；首末帧接近便于循环 |
| `hero-poster.webp` | 否 | 海报与静态兜底层（2560×1440），视频不可用时显示 |
| `archive-poster.webp` | 否 | 终幕档案图（1920×1080） |
| `layers/*.webp` | 否 | 翼光、光环、星点、剑光等独立图层（分层合成用） |

> 音频 `audio/boot.wav` 与 `audio/chime.wav` 由 `scripts/make-audio.py` 程序化合成，
> **随仓库提供**，不属于第三方素材。

## 用自己的素材

只使用**你有权使用**的视频与图层。公开仓库不附带素材提取/转码工具，
直接把文件按上面的命名放进本目录即可：

1. 视频转成 1920×1080 / 6.000s / 24fps / H.264 / yuv420p / 无音轨，命名 `hero-loop.mp4`
   （`ffmpeg -i 你的素材.mp4 -t 6 -r 24 -vf scale=1920:1080 -c:v libx264 -crf 20 -pix_fmt yuv420p -an hero-loop.mp4`）；
2. 首帧导出 `hero-poster.webp`（2560×1440 可选，按 16:9 裁切）；
3. 终幕图导出 `archive-poster.webp`；
4. 如果要做分层合成，把翼光/光环/星点/剑光等透明 PNG/WebP 放进 `layers/`。

放好后：

- 离线预览：直接打开 `preview/index.html`；
- 宿主内效果：确认 `dsh plugin` 安装的是本仓库构建出的 tgz。

`lib/assets/manifest.json` 只是素材元数据记录，插件运行时按固定文件名读取，
不依赖它的字段；不需要改它也能生效。

## 缺失时的行为

- `hero-loop.mp4` 取不到或解码失败 → 走 `no-video` 静帧分支，时间轴照常推进；
- `hero-poster.webp` 也没有 → 启动层保留黑幕/HUD/粒子与转场，仅人物层缺失；
- `layers/*.webp` 缺失 → 对应装饰图层不显示（浏览器按 404 处理），不影响时间轴；
- 音频缺失 → 对应 cue 静默，不 console.error（仅 warn 一次）。

## 为什么入库

体积大，且人物渲染涉及第三方版权。`.gitignore` 排除了
`lib/assets/*.{mp4,webm,webp,jpg,png}` 与 `lib/assets/layers/`，只保留本 README。
