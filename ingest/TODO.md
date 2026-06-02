# 飞书 CLI 每日待办扫描 — 待跟进清单

> 状态(截至上次会话):代码全部完成并离线验证;launchd 每日 08:00 定时**已安装**。
> 还差「填凭证 + 应用 migration 003」就能真正每天出活并被追踪。
> 标记:⚠️ 需要你 · 🔧 可让 Claude 代做

## 让每日扫描真正跑起来(最短路径)

- [ ] ⚠️ **填凭证**:`cp ingest/.env.example ingest/.env`,填入
  - `FEISHU_APP_ID`、`FEISHU_APP_SECRET`(飞书自建应用「凭证与基础信息」)
  - `ANTHROPIC_API_KEY`
- [ ] ⚠️ **飞书应用权限**:开通 scope `im:message:readonly` + `im:chat:readonly`,并把机器人**加进**要扫描的群。
- [ ] ⚠️🔧 **应用 migration 003**:当前 `cadence.db` 仍停在 migration 2(已确认无 `pending_items` 表)。用**含 003 的新构建**打开一次 app:
  ```bash
  cd /Users/bytedance/Desktop/cadence && npm run tauri dev
  ```
  CLI 的 `assertSchema` 通过后才会运行。

## 验证(填完凭证后)

- [ ] 🔧 **离线夹具验证**:`.env` 设 `FEISHU_FIXTURE=fixtures/sample-messages.json`,跑
  ```bash
  cd ingest && node dist/cli.js --dry-run
  ```
  预期:「下周三前交报销」→ AUTO-FILE;「有空看下文档」「回家吃饭」→ PENDING。
- [ ] 🔧 **真实 dry-run**:去掉 fixture,连真实飞书 + Claude,只读不写,看抓出哪些待办。
- [ ] 🔧 **真实写一次**:`node dist/cli.js` → 在 app 看板/待定 tab 确认 → 试「整理入象限」三联。
- [ ] 🔧 **确认追踪台账**:`node dist/cli.js --history` 看 `state/history.md` 是否落账。
- [ ] 🔧 **确认定时触发**:不必等 08:00,手动
  ```bash
  launchctl kickstart -k gui/$(id -u)/com.willyliu.cadence.ingest
  cat ingest/state/ingest.log ingest/state/ingest.err.log
  ```

## 后续增强(非阻塞)

- [ ] ⚠️🔧 **个人私聊覆盖**:tenant token 读不到 1:1 私聊;需 `user_access_token`(OAuth)+ 刷新流程。目前只能手动粘 `FEISHU_USER_TOKEN`。
- [ ] 🔧 **真数据边界检验**:富文本(post)解析、分页、限流、多消息合并去重。
- [ ] 🔧 **(可选)单元测试**:决策规则 / 历史台账 / db 函数(项目已有 vitest)。

## 关键路径备忘

- DB: `~/Library/Application Support/com.willyliu.cadence/cadence.db`(WAL)
- 定时: `~/Library/LaunchAgents/com.willyliu.cadence.ingest.plist`(每天 08:00)
- 追踪: `ingest/state/history.jsonl`(机器) · `ingest/state/history.md`(人读)
- 日志: `ingest/state/ingest.log` · `ingest/state/ingest.err.log`
