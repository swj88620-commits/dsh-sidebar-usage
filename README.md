# DSH Sidebar Usage / 用量与余额

DeepSeek Harness（DSH）Web UI 的侧边栏用量插件：在账号头像上方显示今日 Token、预估消费、账户余额和累计 Token，并在每个会话下方显示该会话的 Token 与预估消费。

> 当前版本按 DSH `0.2.1-rc.3` 的 Sidebar / Client 插槽实现。

## 功能

- **头像上方三行统计**
  - 今日 Token 与预估消费
  - 账户剩余余额（充值余额 + 赠金）
  - 本机累计 Token
- **每个会话下方显示用量**
  - 例：`237.6M tok · ≈¥7.83`
  - 运行中、待审批、空闲会话均可显示
- **会话悬停详情**
  - 本会话 Tokens
  - 预估消费
  - 缓存命中 Tokens
- **可滚动的浮层**
  - 统计面板不拦截鼠标事件，滚轮可穿过面板滚动会话列表
  - 会话列表底部预留滚动空间，最后几个会话不会被面板永久遮挡
- 中英文界面文案，跟随 DSH 当前语言。

## 安装

1. 把 `dsh-sidebar-usage` 文件夹放进 DSH 工作区。
2. 在 DSH 的插件管理页选择本地 Bundle 安装，或让插件管理器安装该目录。
3. 刷新 Web UI（`Ctrl+R` / `Cmd+R`）。

本仓库没有 `node_modules`，也没有构建步骤：`index.js` 是 Host 半，`client.js` 是浏览器半，均为原生 ESM / DSH Client 模块格式。

目录结构：

```text
dsh-sidebar-usage/
├─ index.js             # Host：会话日志聚合与 /dsh-usage/api
├─ client.js            # Client：侧边栏面板、会话下方用量、悬停卡片
├─ cordis.patch.yml     # Bundle 入口
├─ package.json
├─ icon.svg
├─ locale/
│  ├─ en.json
│  └─ zh.json
├─ README.md
├─ LICENSE
└─ .gitignore
```

## 数据来源与隐私

- 会话 Token 数来自 DSH 已提交的 `assistant/message` 会话日志，通过 Host 侧 `sessionQuery` 读取并聚合。
- 账户余额来自 DSH 已登录账号的 `remote.account.getBalance`，插件不会读取、保存或输出 API Key、Cookie 等凭据。
- Host 路由为同源本地路由 `/dsh-usage/api`，不对外发起网络请求。
- 插件只在浏览器内缓存展示数据；刷新页面后重新读取。

## 消费金额说明

消费金额是**估算值**，按 DeepSeek 公开的人民币价格计算，并区分高峰/空闲时段：

- 高峰：周一至周五（北京时间）09:00–12:00、14:00–18:00
- 空闲：其余时段
- 缓存命中、缓存未命中输入和输出分别计价
- 法定节假日未单独建模

实际扣费以 [DeepSeek 开放平台](https://platform.deepseek.com/) 为准。价格常量位于 `index.js` 的 `PRICES` 对象，价格调整后直接修改即可。

## 兼容性

- 测试环境：DSH `0.2.1-rc.3`，Web / Desktop Web UI
- 依赖 DSH 提供的 `sessionQuery`、`webServer`、`remote.account` 服务
- 未登录 DeepSeek 账号时，余额显示“登录后查看”，Token 统计仍可用

## 开发

本项目无需安装依赖，也没有打包步骤。修改 `client.js` 后刷新页面即可看到 Client 改动；修改 `index.js` 后需要让 DSH 重新加载 Host 插件（或在插件管理器中重新安装 Bundle）。

## License

MIT. See [LICENSE](./LICENSE).

---

### English summary

A DSH Web UI sidebar plugin that shows today's token usage / estimated cost, account balance, and total tokens above the account avatar, plus per-session token usage under each session row. The floating summary panel is click-through so the wheel still scrolls the session list, and the list reserves bottom space so sessions are never permanently hidden behind it.
