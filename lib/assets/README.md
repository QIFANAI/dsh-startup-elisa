# 人物素材（随仓库发布）

自 0.6.1 起，`lib/assets/` 里的人物视频、海报与图层**随仓库与官方 Release 完整发布**，
安装后即获得完整观感。文件缺失或解码失败时，插件仍会完整走降级链（静帧 / 无视频分支），
不报错、不中断。

## 文件清单

| 文件 | 必需 | 说明 |
|---|---|---|
| `hero-loop.mp4` | 否（首选） | 1920×1080 / 6.000s / 24fps / H.264 / yuv420p / 无音轨；首末帧接近便于循环 |
| `hero-poster.webp` | 否 | 海报与静态兜底层（2560×1440），视频不可用时显示 |
| `archive-poster.webp` | 否 | 终幕档案图（1920×1080） |
| `layers/*.webp` | 否 | 13 个独立图层：翼光 `wing_1/2`、羽毛 `feather_1/2`、引导线 `guide_1/2/3`、螺旋 `spiral_1/2` + `spiral_line`、光环 `halo`、星点 `star`、剑光 `sword_flare` |

> 音频 `audio/boot.wav` 与 `audio/chime.wav` 由 `scripts/make-audio.py` 程序化合成，
> **随仓库提供**，不属于第三方素材。
> 各文件的尺寸、字节数与 SHA-256 明细见同目录 [manifest.json](manifest.json)。

## 用自己的素材

只使用**你有权使用**的视频与图层。仓库不附带素材提取工具，直接把文件按上面的命名
放进本目录即可：

1. 视频转成 1920×1080 / 6.000s / 24fps / H.264 / yuv420p / 无音轨，命名 `hero-loop.mp4`
   （`ffmpeg -i 你的素材.mp4 -t 6 -r 24 -vf scale=1920:1080 -c:v libx264 -crf 20 -pix_fmt yuv420p -an hero-loop.mp4`）；
2. 首帧导出 `hero-poster.webp`（2560×1440 可选，按 16:9 裁切）；
3. 终幕图导出 `archive-poster.webp`；
4. 要做分层合成时，把翼光/光环/星点/剑光等透明 PNG/WebP 放进 `layers/`，文件名与
   `manifest.json` 的 `layers[].file` 对应即可。

放好后：离线预览直接打开 `preview/index.html`；宿主内效果需确认 `dsh plugin` 安装的是
重新构建出的 tgz。插件运行时按固定文件名读取，不依赖 `manifest.json` 的字段。

## 缺失时的行为

- `hero-loop.mp4` 取不到或解码失败 → 走 `no-video` 静帧分支（优先 `hero-poster.webp`），时间轴照常推进；
- `hero-poster.webp` 也没有 → 启动层保留黑幕/HUD/粒子与转场，仅人物层缺失；
- `layers/*.webp` 缺失 → 对应装饰图层不显示（浏览器按 404 处理），不影响时间轴；
- 音频缺失 → 对应 cue 静默，不 console.error（仅 warn 一次）。

## 素材权利与再分发

这些文件的权利归各自权利人所有，**代码的 MIT 授权不覆盖它们**。再分发、商用或公开演示
前请自行确认你有权使用；若你是权利人并认为随附发布不当，请开 Issue 联系维护者处理。
权威声明见仓库根目录 [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md)。
