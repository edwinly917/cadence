import fs from "node:fs";
import type { Config } from "./config.js";
import type { FeishuMessage } from "./types.js";

const BASE = "https://open.feishu.cn/open-apis";

interface FeishuListResp<T> {
  code: number;
  msg: string;
  data?: {
    items?: T[];
    has_more?: boolean;
    page_token?: string;
  };
}

interface ChatItem {
  chat_id: string;
  name?: string;
}

interface MessageItem {
  message_id: string;
  chat_id: string;
  msg_type: string;
  create_time: string; // ms epoch as string
  sender?: { id?: string; sender_type?: string };
  body?: { content?: string };
}

/** Best-effort extraction of plain text from a Feishu message body.content JSON. */
function extractText(msgType: string, content: string | undefined): string | null {
  if (!content) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (msgType === "text") {
    const t = (parsed as { text?: string }).text;
    return t?.trim() ? t.trim() : null;
  }
  if (msgType === "post") {
    // Rich text: { title, content: [ [ {tag,text}, ... ], ... ] } possibly under locale keys.
    const collect = (node: unknown): string[] => {
      if (Array.isArray(node)) return node.flatMap(collect);
      if (node && typeof node === "object") {
        const o = node as Record<string, unknown>;
        if (typeof o.text === "string") return [o.text];
        return Object.values(o).flatMap(collect);
      }
      return [];
    };
    const text = collect(parsed).join(" ").trim();
    return text ? text : null;
  }
  return null;
}

export interface FeishuClient {
  fetchMessages(since: Date, until: Date, max: number): Promise<FeishuMessage[]>;
}

/** Reads pre-normalized messages from a JSON fixture for offline testing. */
class FixtureClient implements FeishuClient {
  constructor(private path: string) {}
  async fetchMessages(since: Date, until: Date, max: number): Promise<FeishuMessage[]> {
    const raw = JSON.parse(fs.readFileSync(this.path, "utf8")) as
      | { messages: FeishuMessage[] }
      | FeishuMessage[];
    const all = Array.isArray(raw) ? raw : raw.messages;
    return all
      .filter((m) => {
        const t = new Date(m.ts).getTime();
        return t >= since.getTime() && t <= until.getTime();
      })
      .slice(0, max);
  }
}

class LiveClient implements FeishuClient {
  private token: string | null = null;
  constructor(private cfg: Config) {}

  private async tenantToken(): Promise<string> {
    if (this.cfg.feishuUserToken) return this.cfg.feishuUserToken;
    if (this.token) return this.token;
    const resp = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        app_id: this.cfg.feishuAppId,
        app_secret: this.cfg.feishuAppSecret,
      }),
    });
    const json = (await resp.json()) as {
      code: number;
      msg: string;
      tenant_access_token?: string;
    };
    if (json.code !== 0 || !json.tenant_access_token) {
      throw new Error(`获取 tenant_access_token 失败: ${json.code} ${json.msg}`);
    }
    this.token = json.tenant_access_token;
    return this.token;
  }

  private async authedGet<T>(url: string): Promise<FeishuListResp<T>> {
    const token = await this.tenantToken();
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return (await resp.json()) as FeishuListResp<T>;
  }

  private async listChats(): Promise<ChatItem[]> {
    const chats: ChatItem[] = [];
    let pageToken: string | undefined;
    do {
      const qs = new URLSearchParams({ page_size: "100" });
      if (pageToken) qs.set("page_token", pageToken);
      const json = await this.authedGet<ChatItem>(`${BASE}/im/v1/chats?${qs}`);
      if (json.code !== 0) throw new Error(`列出会话失败: ${json.code} ${json.msg}`);
      chats.push(...(json.data?.items ?? []));
      pageToken = json.data?.has_more ? json.data?.page_token : undefined;
    } while (pageToken);
    return chats;
  }

  private async listMessages(
    chat: ChatItem,
    since: Date,
    until: Date,
    remaining: number,
  ): Promise<FeishuMessage[]> {
    const out: FeishuMessage[] = [];
    let pageToken: string | undefined;
    const startSec = Math.floor(since.getTime() / 1000);
    const endSec = Math.floor(until.getTime() / 1000);
    do {
      const qs = new URLSearchParams({
        container_id_type: "chat",
        container_id: chat.chat_id,
        start_time: String(startSec),
        end_time: String(endSec),
        page_size: "50",
        sort_type: "ByCreateTimeAsc",
      });
      if (pageToken) qs.set("page_token", pageToken);
      const json = await this.authedGet<MessageItem>(`${BASE}/im/v1/messages?${qs}`);
      if (json.code !== 0) throw new Error(`拉取消息失败: ${json.code} ${json.msg}`);
      for (const m of json.data?.items ?? []) {
        const text = extractText(m.msg_type, m.body?.content);
        if (!text) continue;
        out.push({
          message_id: m.message_id,
          chat_id: m.chat_id,
          chat_name: chat.name ?? null,
          sender: m.sender?.id ?? null,
          ts: new Date(Number(m.create_time)).toISOString(),
          text,
        });
        if (out.length >= remaining) return out;
      }
      pageToken = json.data?.has_more ? json.data?.page_token : undefined;
    } while (pageToken);
    return out;
  }

  async fetchMessages(since: Date, until: Date, max: number): Promise<FeishuMessage[]> {
    const chats = await this.listChats();
    const all: FeishuMessage[] = [];
    for (const chat of chats) {
      if (all.length >= max) break;
      const msgs = await this.listMessages(chat, since, until, max - all.length);
      all.push(...msgs);
    }
    return all.slice(0, max);
  }
}

export function makeFeishuClient(cfg: Config): FeishuClient {
  if (cfg.feishuFixture) return new FixtureClient(cfg.feishuFixture);
  return new LiveClient(cfg);
}
