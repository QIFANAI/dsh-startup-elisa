# 第三方声明与授权边界

## 一、代码

`dsh-startup-elisa` 的代码、文案与样式以 **MIT** 发布，可商用、可修改、可再分发，
保留版权声明即可。MIT **只覆盖作者原创部分**，不覆盖任何第三方素材、字体或商标。

## 二、人物素材（不随仓库、不随官方 Release 分发）

`lib/assets/` 下的人物视频、海报与图层，来自 Wallpaper Engine 创意工坊场景
**3808922316**（`scene.pkg`），角色为 **HACHIWARE ELISA**：

| 文件 | 用途 |
|---|---|
| `hero-loop.mp4` | 启动层人物视频底板（1920×1080 / 6s / 24fps / H.264） |
| `hero-poster.webp` | 人物海报与静帧兜底（2560×1440） |
| `archive-poster.webp` | 终幕档案图（1920×1080） |
| `layers/*.webp` | 独立图层（翼光、光环、星点、剑光等） |

这些内容**仅限维护者本机自用**，禁止上传、公开分发、售卖或用于商业发布。
官方 Git 仓库与 GitHub Release **不包含**这些文件；`.gitignore` 已排除，
公开安装包中也只有代码、文档、测试与**程序化合成的音频**。

## 三、程序化音频（随仓库分发）

`lib/assets/audio/boot.wav`（7.8s 主声轨）与 `lib/assets/audio/chime.wav`（1.35s）
由本项目 `scripts/make-audio.py` 用 Python + numpy 合成，**不含任何外部采样、
商业 BGM 或第三方录音**，随 MIT 代码一并授权。

## 四、README 截图

`docs/screenshots/*.png` 是宿主界面与输入框的界面演示截图，**不含人物形象**，
随仓库用于说明皮肤效果，在 MIT 范围内。

## 五、字体

插件不附带字体文件。标题与正文使用系统字体（`Noto Serif SC` / `Songti SC` /
`SimSun` / `serif` / `ui-monospace` / `Consolas`），不涉及字体授权。

## 六、商标与从属

“DeepSeek / DeepSeek Harness”归深度求索公司所有；“HACHIWARE ELISA”及相关角色
归其权利人所有。本项目为社区作品，**不代表任何官方**，也未获得任何官方背书。

## 七、使用自己的素材

公开仓库在无人物素材时仍可完整运行：启动层走静帧/无视频降级，皮肤、交接转场、
音轨与全部设置项不受影响。若要还原完整观感，请自备**你有权使用**的人物视频与图层，
按 `lib/assets/README.md` 的命名放入即可；插件按同名文件读取，缺失时自动降级。

自行准备、使用、分发素材所产生的授权与法律责任，由使用者自行承担。
