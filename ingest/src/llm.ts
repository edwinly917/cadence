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

/** Parse JSON, retrying once after stripping trailing commas (a common LLM slip). */
function lenientParse<T>(s: string): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return JSON.parse(s.replace(/,(\s*[}\]])/g, "$1")) as T;
  }
}

/** Extract a single JSON object/array from arbitrary model text (strips ``` fences). */
export function extractJson<T>(text: string): T {
  const trimmed = text.trim();
  const candidates: string[] = [trimmed];
  // ```json ... ``` or ``` ... ```
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());
  // First { ... } or [ ... ] span.
  const start = trimmed.search(/[[{]/);
  const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  if (start !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1));

  let lastErr = "";
  for (const c of candidates) {
    try {
      return lenientParse<T>(c);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`无法从模型输出解析 JSON(${lastErr}):\n${trimmed.slice(0, 400)}`);
}

function viaClaudeCli<T>(cfg: Config, call: LlmCall): T {
  const schemaHint = call.tool
    ? `\n\n你的输出必须是一个 JSON 对象,且匹配以下 JSON Schema:\n${JSON.stringify(
        call.tool.input_schema,
      )}`
    : "";
  const prompt = `${call.system}\n\n${call.user}${schemaHint}\n\n严格要求:只输出一个合法 JSON 本体,不要任何解释文字、不要 markdown 代码块标记。
JSON 合法性:字符串内的双引号必须转义为 \\",字符串内不能有未转义的换行(用 \\n),不要尾随逗号。`;
  // Pass the prompt as a positional arg (NOT stdin — stdin piping can hang/stall
  // claude -p), and disable MCP + extra setting sources so headless runs start
  // fast and don't hang on MCP init.
  const args = [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--strict-mcp-config",
    "--setting-sources",
    "",
  ];
  if (cfg.claudeCliModel) args.push("--model", cfg.claudeCliModel);

  const attempts = 3;
  let lastErr = "";
  for (let i = 0; i < attempts; i++) {
    const res = spawnSync(cfg.claudeBin, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.error) throw new Error(`无法运行 ${cfg.claudeBin}: ${res.error.message}`);
    // `--output-format json` wraps the answer: { type:"result", result:"<text>", is_error }
    let answer = res.stdout ?? "";
    let isError = res.status !== 0;
    try {
      const env = JSON.parse(res.stdout) as { result?: unknown; is_error?: boolean };
      if (env && typeof env.result === "string") answer = env.result;
      if (env && env.is_error) isError = true;
    } catch {
      // stdout wasn't the envelope — treat raw stdout as the answer.
    }
    if (!isError) {
      try {
        return extractJson<T>(answer);
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    } else {
      lastErr = `claude CLI 报错 (exit ${res.status}): ${answer || res.stderr}`;
    }
    if (i < attempts - 1) spawnSync("sleep", ["3"]); // brief backoff before retry
  }
  throw new Error(lastErr || "claude CLI 调用失败");
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
