# combo · 对话安装包源文件

本目录是「**把 zip 拖进 DSH 对话框，对代理说『帮我安装这个插件』**」这条安装路径的源文件。

| 文件 | 作用 |
|---|---|
| `00-给DSH的安装说明.md` | 给 DSH 代理读的执行说明（定位 → 校验 → 备份 → 安装 → 验收） |
| `01-使用说明与排错.md` | 给人读的功能、配置、排错、回滚 |
| `tools/install-elisa.ps1` | 无损安装器：校验 tgz + 包内全部文件 → 备份 → 已装先 remove → `dsh plugin add` → 装后 6 项验收 |
| `tools/verify-elisa.ps1` | 只读完整性核验器：版本 / 文件哈希 / profile bundles |

## 构建组合包

先构建发布 tgz（或从 Release 下载放到 `releases/`），再：

```powershell
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\make-combo-package.ps1
```

脚本会：

1. 读取 `releases/dsh-startup-elisa-0.6.1.tgz` 的 SHA256/大小（可用 `-ExpectedSha256` 对照 Release 页）；
2. 解包生成 `校验清单.sha256`（包内全部文件 + tgz 基线）；
3. 把 `.ps1` 统一为 UTF-8 with BOM；用 7z（没有则回落 .NET ZipFile）打成
   `Elisa启动动画+UI皮肤组合包.zip`；
4. 复核 zip 结构、条目与内嵌 tgz 哈希。

产物 **不入库**（`*.zip` 在 `.gitignore` 中），发布时按需分发。

## 公开 Release 包与本地 -full 包

- **公开 Release 包**（GitHub Release）：代码、文档、测试、程序化音轨，
  **并含完整人物视频/海报/图层**（自 0.6.1 起，`release.json` 声明 `mediaIncluded=true`）。
- **本地 `-full` 包**：`npm run build:full` 兼容保留，内容与 source 包相同。
  两种包都能用同一套组合包脚本组装；安装器不再绑定固定哈希，
  一律按包内 `校验清单.sha256` 校验。

## 素材边界

人物素材权利归各自权利人，代码 MIT 不覆盖素材；再分发前请自行确认授权。
权威声明见根目录 [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md)；
素材规格与替换方法见 [lib/assets/README.md](../lib/assets/README.md)。
