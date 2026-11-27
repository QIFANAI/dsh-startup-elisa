# 维护手册 · 升级 / 发布 / 回滚

> 设计口径以 [docs/design/design-spec-v6.md](docs/design/design-spec-v6.md) 为 v0.6 唯一源；
> 安装与排错以 [INSTALL.md](INSTALL.md) 为准。本页只管「以后怎么改、怎么发、怎么退」。

## 1. 目录职责

| 路径 | 职责 | 改完如何生效 |
|---|---|---|
| `lib/index.js` | Host 半侧：`/dsh-elisa/*` 路由、首屏注入、配置读写、facts | 重启 DSH |
| `lib/client.js` | 设置页「ELISA 启动动画」、皮肤加载、ambient 注入 | 刷新客户端 |
| `lib/splash.js`、`lib/splash.css` | 宿主内启动层、ready/progress/done 协议、交接转场 | 刷新客户端 |
| `lib/audio.js` | 音轨引擎（变速不变调、手势补播、warn-only 降级） | 刷新客户端 |
| `lib/skin.css` | 四档皮肤、三主题、动态背景 11 层、composer 流动光边框 | 刷新客户端 |
| `lib/assets/` | 人物素材（自 0.6.1 起随仓库与 Release 发布）+ 程序化音频 | 刷新客户端 |
| `preview/index.html` | 离线预览：`?t=`、`?speed=`、`?reduced=1`、`?probe=1` | 双击即看 |
| `test/` | 五套冒烟断言 | `npm test` |
| `scripts/make-audio.py` | 程序化合成 `boot.wav` / `chime.wav` | 重新生成后入包 |
| `scripts/build-release.mjs` | 可复现发布包（source，含完整素材）/ 兼容 full 包 | `npm run build` |
| `scripts/check-public.mjs` | 公开仓库门禁 | `npm run check` |
| `scripts/install.mjs` | Release 下载、校验、交给 `dsh plugin` | `node scripts/install.mjs` |
| `combo/` | 「拖进对话框即装」组合包说明与安装/核验脚本 | `scripts/make-combo-package.ps1` |
| `.github/workflows/` | CI 与 tag 发布 | push / tag |
| `release.json` | 当前 Release 的版本、大小、SHA-256 | 构建后写回并提交 |

## 2. 本地开发

```bash
npm test
npm run check
node scripts/build-release.mjs --mode full   # 兼容保留：重建 -full 包（内容与 source 相同）
```

仓库自带完整素材，`npm test` 为 497 项；素材被删时自动跳过/改验缺失路径。两种都必须 PASS。

## 3. 发版流程（按序执行）

1. **升版本号**：`package.json` 的 `version`；同步 `README.md`、`INSTALL.md`、
   `CHANGELOG.md`、`test/smoke-splash.mjs` 的版本断言。
2. `npm test`：全 PASS。
3. `npm run check`：公开门禁全 PASS。
4. `npm run build -- --write-manifest`：打包 git 已跟踪文件（含全部人物素材），写 `release.json`。
5. `git add -A && git commit`，确认工作区干净。
6. `git tag v<ver> && git push origin main --tags`。
7. GitHub Actions 的 release 工作流会重新建包、比对 `release.json` 并创建 Release。
8. 用安装器做一次真实安装验收：

```bash
node scripts/install.mjs --profile desktop --version <ver> --dry-run
```

素材随仓库与 Release 完整发布；上传前确认 `release.json` 的 `mediaIncluded=true`，
且 16 个人物素材都在 tag 的文件树里。

## 4. 可复现构建

- source 模式只复制 `git ls-files` 的结果，包内容 = 提交内容（自 0.6.1 起含全部 16 个人物素材），
  构建脚本会断言 16 个素材一个不少；
- 文件 mtime 统一为 1985-10-26，npm 打包排序固定；
- `release.json` 的 `size` / `sha256` 由构建脚本写入，CI 重建后必须一致；
- 本地与 CI 的 npm 主版本保持一致的机器上生成 manifest（当前 npm 11.19.0）。

## 5. 组合包（可选分发方式）

`combo/` 是给「把 zip 拖进 DSH 对话框让代理安装」这条路径用的：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-combo-package.ps1
```

它从 `releases/*.tgz` 生成 `校验清单.sha256`，再按 `combo/` 说明与脚本组装 zip。
公开 Release 的 tgz 与本地 `-full` 包都可以用它组装（两者内容相同）；安装器按清单校验，不绑定固定哈希。

## 6. 回滚

- 装回旧版：从旧 Release 下载 tgz，按 [INSTALL.md](INSTALL.md) 安装；
- 恢复默认设置：删除 `~/.dsh/dsh-startup-elisa.json`；
- 源码回滚：`git checkout <旧 tag>` 后重新 `dsh plugin --profile desktop add <tgz>`。

## 7. 已知事项

- 同一 profile 只能启用一个启动插件（与 nostromo / yomi / screen 互斥）；
- 官方 Release 含完整人物视频、海报与图层（`mediaIncluded=true`），与仓库逐字节一致；
- 素材降级链：`hero-loop.mp4` → 静帧/无视频分支；图层缺失只影响装饰层；
- 软光栅 TaskDuration 相对 v0.5 有 +173% 的回退（已知风险），GPU 合成实测无明显掉帧；
  详细数据与回退建议见 `docs/verify/qa-report-v6.md`。
