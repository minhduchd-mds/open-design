/*
 * /contact-sales — Workspace-for-Teams lead intake.
 *
 * The /enterprise/ page POSTs a lead here; we validate it, fan it out to a
 * Feishu (Lark) custom-bot webhook so the team gets a real-time card, and keep
 * a KV backup so a Feishu outage never silently drops a lead. Mirrors the
 * shape and safety posture of `subscribe.ts` (CORS allowlist, no PII in
 * provider logs, idempotent KV key, delivery on `waitUntil`).
 *
 * Config (Cloudflare Pages env):
 * - FEISHU_CONTACT_WEBHOOK  custom-bot incoming webhook URL (required to notify)
 * - FEISHU_CONTACT_SECRET   optional bot signing secret (set if the bot enforces
 *                           signature verification)
 * - CONTACT_LEADS           optional KV namespace for the durable backup
 */
type KVNamespace = {
  put(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
};

type PagesFunctionContext<Env> = {
  request: Request & { cf?: Record<string, unknown> };
  env: Env;
  waitUntil(promise: Promise<unknown>): void;
};

type PagesFunction<Env> = (context: PagesFunctionContext<Env>) => Response | Promise<Response>;

interface Env {
  CONTACT_LEADS?: KVNamespace;
  FEISHU_CONTACT_WEBHOOK?: string;
  FEISHU_CONTACT_SECRET?: string;
}

type ContactLead = {
  name: string;
  email: string;
  company: string;
  teamSize: string;
  useCases: string[];
  role: string;
  message: string;
  source: string;
  locale: string;
  pageUrl: string;
  submittedAt: string;
  referer: string | null;
  country?: string;
  region?: string;
};

const ALLOWED_ORIGINS = [
  "https://open-design.ai",
  "https://www.open-design.ai",
  "https://staging.open-design.ai",
  "od://app",
  "tauri://localhost",
  "http://localhost",
  "http://127.0.0.1",
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const MAX_SHORT = 200;
const MAX_MESSAGE = 4000;
const ALLOWED_SOURCES = new Set(["enterprise", "client"]);
const ALLOWED_TEAM_SIZES = new Set(["1-10", "11-50", "51-200", "200+"]);
const ALLOWED_USE_CASES = new Set([
  "product_design",
  "design_system",
  "prototype",
  "marketing",
  "deck",
  "dashboards",
  "other",
]);
const USE_CASE_LABELS: Record<string, string> = {
  product_design: "Product & app design",
  design_system: "Design system",
  prototype: "Prototype / app UI",
  marketing: "Marketing & landing pages",
  deck: "Presentation / deck",
  dashboards: "Dashboards / internal tools",
  other: "Something else",
};

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin &&
    ALLOWED_ORIGINS.some((o) => origin === o || origin.startsWith(`${o}:`))
      ? origin
      : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(origin),
    },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function readString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// Accept a multi-select use-case array; keep only known, de-duplicated values.
function readUseCases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && ALLOWED_USE_CASES.has(item) && !out.includes(item)) {
      out.push(item);
    }
  }
  return out;
}

// Feishu custom-bot signature: base64(HmacSHA256(key = `${timestamp}\n${secret}`, data = "")).
async function feishuSignature(secret: string, timestamp: number): Promise<string> {
  const keyBytes = new TextEncoder().encode(`${timestamp}\n${secret}`);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new Uint8Array(0));
  return bytesToBase64(new Uint8Array(sig));
}

function buildFeishuCard(lead: ContactLead): Record<string, unknown> {
  const fieldRow = (label: string, value: string) => ({
    is_short: true,
    text: { tag: "lark_md", content: `**${label}**\n${value || "—"}` },
  });
  const geo = [lead.country, lead.region].filter(Boolean).join(" / ");
  return {
    config: { wide_screen_mode: true },
    header: {
      template: "green",
      title: { tag: "plain_text", content: "🚀 New Workspace-for-Teams lead" },
    },
    elements: [
      {
        tag: "div",
        fields: [
          fieldRow("Name", lead.name),
          fieldRow("Email", lead.email),
          fieldRow("Company", lead.company),
          fieldRow("Team size", lead.teamSize),
          fieldRow("Use case", lead.useCases.map((v) => USE_CASE_LABELS[v] ?? v).join(", ")),
          fieldRow("Role", lead.role),
          fieldRow("Locale", lead.locale),
        ],
      },
      ...(lead.message
        ? [
            { tag: "hr" },
            {
              tag: "div",
              text: { tag: "lark_md", content: `**Message**\n${lead.message}` },
            },
          ]
        : []),
      { tag: "hr" },
      {
        tag: "note",
        elements: [
          {
            tag: "plain_text",
            content: `source: ${lead.source}${geo ? ` · ${geo}` : ""} · ${lead.submittedAt}`,
          },
        ],
      },
    ],
  };
}

async function notifyFeishu(env: Env, lead: ContactLead): Promise<void> {
  const webhook = env.FEISHU_CONTACT_WEBHOOK?.trim();
  if (!webhook) {
    console.warn("contact_sales_feishu_unset: FEISHU_CONTACT_WEBHOOK missing; KV only");
    return;
  }

  const body: Record<string, unknown> = {
    msg_type: "interactive",
    card: buildFeishuCard(lead),
  };

  const secret = env.FEISHU_CONTACT_SECRET?.trim();
  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    body.timestamp = String(timestamp);
    body.sign = await feishuSignature(secret, timestamp);
  }

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn("contact_sales_feishu_failed", JSON.stringify({ status: res.status }));
      return;
    }
    // Feishu returns 200 with a JSON body even on logical failure (e.g. bad sign).
    const data = (await res.json().catch(() => ({}))) as { code?: unknown };
    if (typeof data.code === "number" && data.code !== 0) {
      console.warn("contact_sales_feishu_rejected", JSON.stringify({ code: data.code }));
    }
  } catch {
    console.warn("contact_sales_feishu_request_failed");
  }
}

async function persistLead(env: Env, lead: ContactLead): Promise<void> {
  if (env.CONTACT_LEADS) {
    // Latest submission per email wins; keeps the namespace from growing
    // unbounded on repeat submits while preserving the freshest details.
    const key = `lead:${await sha256Hex(lead.email)}`;
    try {
      await env.CONTACT_LEADS.put(key, JSON.stringify(lead));
    } catch {
      console.warn("contact_sales_kv_write_failed");
    }
  } else {
    console.warn(
      "contact_sales_kv_unbound: CONTACT_LEADS binding missing; lead not persisted",
      JSON.stringify({ source: lead.source, country: lead.country }),
    );
  }

  await notifyFeishu(env, lead);
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const request = context.request;
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405, origin);
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400, origin);
  }

  const email = readString(payload.email, MAX_EMAIL_LENGTH).toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return json({ ok: false, error: "invalid_email" }, 400, origin);
  }

  const name = readString(payload.name, MAX_SHORT);
  const company = readString(payload.company, MAX_SHORT);
  const teamSize = readString(payload.teamSize, MAX_SHORT);
  const useCases = readUseCases(payload.useCases);
  if (
    !name ||
    !company ||
    !ALLOWED_TEAM_SIZES.has(teamSize) ||
    useCases.length === 0
  ) {
    return json({ ok: false, error: "missing_fields" }, 400, origin);
  }

  const source =
    typeof payload.source === "string" && ALLOWED_SOURCES.has(payload.source)
      ? payload.source
      : "unknown";

  const cf = request.cf || {};
  const lead: ContactLead = {
    name,
    email,
    company,
    teamSize,
    useCases,
    role: readString(payload.role, MAX_SHORT),
    message: readString(payload.message, MAX_MESSAGE),
    source,
    locale: readString(payload.locale, 16) || "en",
    pageUrl: readString(payload.pageUrl, 512),
    submittedAt: new Date().toISOString(),
    referer: request.headers.get("referer"),
    country: typeof cf.country === "string" ? cf.country : undefined,
    region: typeof cf.region === "string" ? cf.region : undefined,
  };

  context.waitUntil(persistLead(context.env, lead));

  return json({ ok: true }, 200, origin);
};

export const __contactSalesTest = {
  corsHeaders,
  buildFeishuCard,
  feishuSignature,
};
