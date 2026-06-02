import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config.js";
import type { FeishuMessage, LlmCandidate, LlmResult } from "./types.js";

const BATCH_SIZE = 50;

const SYSTEM_PROMPT = `你是一个把飞书聊天消息抽取成个人待办的助手,服务于一个"四象限"任务管理工具。

四象限由两个二元维度决定:
- importance(重要性):1=重要,0=不重要
- urgency(紧急性):1=紧急,0=不紧急
组合:重要紧急 / 重要不紧急 / 不重要不紧急 / 紧急不重要。

dimension(维度):"work"=工作,"life"=生活。

DDL(截止):
- "hard"=有明确日历日期,用 ddl_date 填 YYYY-MM-DD(本地日历日,不要带时区/时间)。
- "soft"=只有相对时长(如"这周内""一个月内"),用 ddl_duration_days 填天数。
- 没有任何时间信息则 ddl_type=null。

抽取规则:
- 只抽取对"我"(消息接收者)有意义的、真正可执行的待办事项。
- 忽略寒暄、表情、闲聊、纯通知、与我无关的内容。
- 同一件事在多条消息里重复出现时,合并为一个候选,source_message_ids 列出所有相关消息 id。
- 对每个字段:能明确判断就给值,判断不出就给 null(尤其是 importance/urgency/dimension/ddl)。
- confidence 表示你对"这是一个该被记录的待办,且抽取的字段可靠"的整体信心(0..1)。
- auto_fileable=true 当且仅当 dimension、importance、urgency 都非空,且能给出可用 DDL,且你信心较高。
- reason 用一句话说明判断依据。
- 没有任何待办时返回空数组。`;

const TOOL = {
  name: "emit_candidates",
  description: "返回从这批消息中抽取出的待办候选列表。",
  input_schema: {
    type: "object" as const,
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            source_message_ids: { type: "array", items: { type: "string" } },
            title: { type: "string" },
            description: { type: ["string", "null"] },
            dimension: { type: ["string", "null"], enum: ["work", "life", null] },
            importance: { type: ["integer", "null"], enum: [0, 1, null] },
            urgency: { type: ["integer", "null"], enum: [0, 1, null] },
            ddl_type: { type: ["string", "null"], enum: ["hard", "soft", null] },
            ddl_date: { type: ["string", "null"] },
            ddl_duration_days: { type: ["integer", "null"] },
            confidence: { type: "number" },
            auto_fileable: { type: "boolean" },
            reason: { type: "string" },
          },
          required: [
            "source_message_ids",
            "title",
            "confidence",
            "auto_fileable",
            "reason",
          ],
        },
      },
    },
    required: ["candidates"],
  },
};

function formatBatch(messages: FeishuMessage[]): string {
  return messages
    .map(
      (m) =>
        `[id=${m.message_id}] (${m.chat_name ?? m.chat_id} · ${m.sender ?? "?"} · ${m.ts.slice(0, 16)})\n${m.text}`,
    )
    .join("\n\n");
}

export class Classifier {
  private client: Anthropic;
  constructor(private cfg: Config) {
    this.client = new Anthropic({ apiKey: cfg.anthropicApiKey });
  }

  async classify(messages: FeishuMessage[], todayIso: string): Promise<LlmCandidate[]> {
    const all: LlmCandidate[] = [];
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      const out = await this.classifyBatch(batch, todayIso);
      all.push(...out);
    }
    return all;
  }

  private async classifyBatch(
    batch: FeishuMessage[],
    todayIso: string,
  ): Promise<LlmCandidate[]> {
    const resp = await this.client.messages.create({
      model: this.cfg.anthropicModel,
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "emit_candidates" },
      messages: [
        {
          role: "user",
          content: `今天是 ${todayIso}(用于解析"下周三""月底"等相对时间)。\n\n以下是飞书消息:\n\n${formatBatch(batch)}`,
        },
      ],
    });
    const toolUse = resp.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return [];
    const result = toolUse.input as LlmResult;
    return result.candidates ?? [];
  }
}
