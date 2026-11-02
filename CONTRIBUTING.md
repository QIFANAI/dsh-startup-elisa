# 贡献指南

## 先读什么

- 设计口径：[docs/design/design-spec-v6.md](docs/design/design-spec-v6.md) 是 v0.6 唯一源；
- 安装与排错：[INSTALL.md](INSTALL.md)；
- 版权边界：[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)；
- 维护与发版：[MAINTAIN.md](MAINTAIN.md)。

## 开发环境

- Node.js >= 20（项目零运行时依赖，不需要 `npm install`）；
- 主要实机环境：Windows 11 + Edge / DeepSeek Harness Desktop；其他平台欢迎补验证记录；
- `scripts/make-audio.py` 需要 Python 3.10+ 与 numpy（只用它合成音频）。

```bash
npm test       # 五套冒烟
npm run check  # 公开仓库门禁
```

## 可以提交什么

- 代码、样式、文案、测试、文档改进；
- 无素材降级链、可访问性、性能与降级路径改进；
- 安装器、构建可复现性、CI、排错文档；
- 你有明确授权、且能证明授权的素材（默认不接收第三方角色视频/商业 BGM）。

## 不要提交什么

- `lib/assets/` 下的第三方视频、海报、图层；
- 本机路径、用户名、profile 快照、日志、安装验收记录；
- 只改断言让测试变绿、没有定位根因的「修复」；
- 与启动序列/皮肤无关的依赖或全局脚本。

## 修改约定

1. 先复现/定位，再改代码；不要用关闭断言的方式绕过失败。
2. 改时间线、交互、皮肤结构时，同步检查 `test/smoke-splash.mjs`、`test/smoke-speed.mjs`、
   `test/smoke-skin.mjs` 的契约断言。
3. 改版本号时同步：`package.json`、`release.json`、`README.md`、`INSTALL.md`、
   `CHANGELOG.md`、`test/smoke-splash.mjs` 的版本断言。
4. 改公开文件后跑 `npm run check`，确保没有本机路径、断链或媒体混入。
5. 提交说明用简体中文，写清「改了什么 / 为什么 / 怎么验证」。

## Pull Request 检查表

- [ ] `npm test` 全 PASS
- [ ] `npm run check` 全 PASS
- [ ] 没有新增第三方素材
- [ ] 没有本机绝对路径或敏感日志
- [ ] 版本号与文档同步
- [ ] 视觉改动附截图（1600×1020 或说明为何不需要）

## 发布

维护者流程见 [MAINTAIN.md](MAINTAIN.md)。Release 由 tag 触发 CI 构建；
不要手动上传含人物素材的完整包。
