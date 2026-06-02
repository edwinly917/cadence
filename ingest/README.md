# cadence-ingest

每天从飞书 IM 拉取聊天消息,用 Claude 扫描抽取候选待办,直接写入 cadence 的本地 SQLite:

- **能明确分类(work/life + 重要/紧急)且能划定 DDL 的** → 直接落入四象限看板(`tasks`,`status=active`)。
- **判断不出的** → 进入「待定」收件箱(`pending_items`),在 App 里手动「三联」(补全重要/紧急/DDL)后整理入象限。

是一个**独立的 Node CLI**,不在 Tauri 应用内运行;通过 launchd/cron 定时跑。

## 前置

1. **先打开一次 Cadence 桌面应用**,让它跑完 migration 003(创建 `pending_items` 表 + `tasks` 的 `source/source_ref/ingest_confidence` 列)。CLI 自己**绝不**改表结构,缺列会直接报错退出。
2. 飞书自建应用,授予 scope:`im:message:readonly` + `im:chat:readonly`,并把机器人加进要读取的群。
3. Node 18+(用到全局 `fetch`)。

> **覆盖范围说明**:tenant_access_token 只能读机器人所在的群 + 与机器人的单聊。要覆盖你**个人私聊**,需配置 `FEISHU_USER_TOKEN`(user_access_token,OAuth)——列为后续。

## 安装

```bash
cd ingest
npm install
cp .env.example .env   # 填入 FEISHU_APP_ID / FEISHU_APP_SECRET / ANTHROPIC_API_KEY
npm run build
```

## 使用

```bash
# 试运行:只拉取+分类并打印决策,不写库、不推进水位
npm run dev -- --dry-run        # 用 tsx 直接跑源码
# 或构建后:
node dist/cli.js --dry-run

# 正式运行(写库)
node dist/cli.js

# 查看每日扫描的追踪记录(最近 N 次,默认 7)
node dist/cli.js --history
node dist/cli.js --history 30
```

## 每日扫描追踪

每次正式运行都会把"这天扫到了什么"持续追加到:
- `state/history.jsonl` — 机器可读,每行一次运行(窗口、计数、逐条候选)。
- `state/history.md` — 人可读,按运行分节,每条标 `✅入象限` / `📥待定`(重复会标「重复跳过」),附维度/DDL/置信度/来源。

随时 `node dist/cli.js --history` 回看;`dry-run` 不写追踪(它本就不落库)。

### 离线测试(不连飞书)

`.env` 里设 `FEISHU_FIXTURE=fixtures/sample-messages.json`,即可用本地夹具代替真实飞书 API(仍需 `ANTHROPIC_API_KEY` 做分类)。

预期:`下周三前交报销` → AUTO-FILE(带 DDL);`有空看下文档`/`回家吃饭`/纯闲聊 → PENDING 或被忽略。

## 决策规则(「明确能分类且划定 DDL」)

CLI 自行复核,不盲信 LLM 的 `auto_fileable`。全部满足才自动入象限:

1. `confidence >= CONFIDENCE_THRESHOLD`(默认 0.75)
2. `dimension`、`importance`、`urgency` 均非空
3. 有可用 DDL(hard 有日期 / soft 有天数);`REQUIRE_DDL_FOR_AUTOFILE=true` 时强制

否则进「待定」,保留 LLM 的部分猜测供三联预填。

## 幂等

去重键 `source_ref` = `feishu:<message_id>`(多消息合成用排序后 id 哈希)。
- auto-file 前同时查 `tasks.source_ref` 与 `pending_items.dedupe_key`(跨两表)。
- 重叠拉取窗口(`LOOKBACK_HOURS`)重复抓到的消息不会重复插入。
- 水位 `state/watermark.json` **仅在写阶段完全成功后**推进;崩溃则重跑,靠去重吸收。

## 定时(launchd)

见 `com.willyliu.cadence.ingest.plist`(顶部有安装步骤)。cron 备选:

```cron
0 8 * * * cd /Users/bytedance/Desktop/cadence/ingest && /usr/local/bin/node dist/cli.js >> state/ingest.log 2>&1
```

## 安全边界

- CLI **只读写数据行**,绝不跑 DDL、绝不碰 sqlx 的 `_sqlx_migrations`(应用独占迁移)。
- 用 `better-sqlite3` 直接打开应用的同一个 `cadence.db`(WAL 已开,可与应用并发);`busy_timeout=5000` + 单事务写入。
