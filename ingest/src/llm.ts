import { spawnSync } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config.js";

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LlmCall {
  system: string;
  user: string;
  /** Structured-output tool used by the SDK path; also embedded as a schema hint for the CLI path. */
  tool?: AnthropicTool;
  maxTokens?: number;
}

/** Extract a single JSON object/array from arbitrary model text (strips ``` fences). */
export function extractJson<T>(text: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // fall through
  }
  // ```json ... ``` or ``` ... ```
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim()) as T;
    } catch {
      // fall through
    }
  }
  // First balanced-ish { ... } or [ ... ] span.
  const start = trimmed.search(/[[{]/);
  const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  if (start !== -1 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  }
  throw new Error(`无法从模型输出解析 JSON:\n${trimmed.slice(0, 500)}`);
}

function viaClaudeCli<T>(cfg: Config, call: LlmCall): T {
  const schemaHint = call.tool
    ? `\n\n你的输出必须是一个 JSON 对象,且匹配以下 JSON Schema:\n${JSON.stringify(
        call.tool.input_schema,
      )}`
    : "";
  const prompt = `${call.system}\n\n${call.user}${schemaHint}\n\n严格要求:只输出 JSON 本体,不要任何解释文字、不要 markdown 代码块标记。`;
  const args = ["-p", "--output-format", "json"];
  if (cfg.claudeCliModel) args.push("--model", cfg.claudeCliModel);
  const res = spawnSync(cfg.claudeBin, args, {
    input: prompt,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw new Error(`无法运行 ${cfg.claudeBin}: ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(`claude CLI 失败 (exit ${res.status}): ${res.stderr || res.stdout}`);
  }
  // `--output-format json` wraps the answer: { type:"result", result:"<text>", ... }
  let answer = res.stdout;
  try {
    const env = JSON.parse(res.stdout) as { result?: unknown; is_error?: boolean };
    if (env && typeof env.result === "string") answer = env.result;
  } catch {
    // stdout wasn't the envelope — treat raw stdout as the answer.
  }
  return extractJson<T>(answer);
}

async function viaSdk<T>(cfg: Config, call: LlmCall): Promise<T> {
  const client = new Anthropic({ apiKey: cfg.anthropicApiKey });
  const resp = await client.messages.create({
    model: cfg.anthropicModel,
    max_tokens: call.maxTokens ?? 4096,
    system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
    ...(call.tool
      ? {
          tools: [call.tool as unknown as Anthropic.Tool],
          tool_choice: { type: "tool" as const, name: call.tool.name },
        }
      : {}),
    messages: [{ role: "user", content: call.user }],
  });
  if (call.tool) {
    const toolUse = resp.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("模型未返回 tool_use 结构化结果");
    }
    return toolUse.input as T;
  }
  const textBlock = resp.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
  return extractJson<T>(text);
}

/** Complete a prompt and return parsed JSON of type T. Backend chosen by cfg.useClaudeCli. */
export async function completeJson<T>(cfg: Config, call: LlmCall): Promise<T> {
  if (cfg.useClaudeCli) return viaClaudeCli<T>(cfg, call);
  return viaSdk<T>(cfg, call);
}
