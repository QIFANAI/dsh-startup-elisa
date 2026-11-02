# 安全策略

## 支持范围

当前维护 `0.6.x`。安全修复优先进入最新 Release；旧版本不单独回补。

## 报告方式

请使用 GitHub 的 **Security → Report a vulnerability**（私密安全公告），不要在
公开 Issue 里贴可利用细节、token、profile 内容或用户路径。

报告时尽量提供：

- 受影响版本与 profile（desktop / web）；
- 复现步骤与最小示例；
- 影响判断（例如路径穿越、任意文件读、配置写入、XSS、供应链）；
- 已做的缓解措施。

## 范围

本项目关注：

- `/dsh-elisa/lib/assets/*` 静态资源路由的扩展名白名单与路径穿越防护；
- `/dsh-elisa/config` 的字段白名单、区间夹取与原子写；
- `tapIndex` 注入内容（HUD facts、配置）的转义与 CSP 兼容；
- `install.mjs` 对 Release 资产的 SHA-256 / 大小校验；
- 构建流程是否可能把本机素材、本机路径或凭据带进公开包。

不接收：

- 仅影响已停止维护的 DSH 版本的漏洞；
- 需要本机已被完全控制才能触发的提权链；
- 第三方素材本身的版权争议（请走普通 Issue，并附权利证明）。

## 设计上的安全边界

插件不采集遥测，不向外部服务发送配置或使用数据。`install.mjs` 只访问 GitHub
Release API 与资产地址，校验后调用本机 `dsh plugin`，不执行远程脚本。
