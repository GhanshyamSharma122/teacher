import dotenv from "dotenv";

dotenv.config({
  path: "./.env",
});

/**
 * DeepSeek proxy configuration.
 *
 * The proxy exposes an OpenAI-compatible endpoint (see FreeDeepseekAPI-EN/docs/INTEGRATION.md):
 *   POST {DEEPSEEK_BASE_URL}/chat/completions
 *
 * `AI_KEY` is kept as the API key variable for backwards compatibility, but
 * `DEEPSEEK_API_KEY` takes precedence when set. The key is only required if the
 * proxy was started with PROXY_API_KEY; otherwise it is ignored.
 */
const DEEPSEEK_BASE_URL = (
  process.env.DEEPSEEK_BASE_URL || "http://127.0.0.1:9655/v1"
).replace(/\/+$/, "");

const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-reasoner";

const DEEPSEEK_API_KEY =
  process.env.DEEPSEEK_API_KEY || process.env.AI_KEY || "";

const MAX_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 120000;

const isRetryableError = (err) => {
  if (err.name === "AbortError") return true;
  const match = /proxy error (\d{3})/.exec(err.message);
  if (match) {
    const status = Number(match[1]);
    return status === 429 || status >= 500;
  }
  // Network / unknown errors are worth retrying once.
  return true;
};

const callDeepSeek = async ({ prompt, system }) => {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(DEEPSEEK_API_KEY
          ? { Authorization: `Bearer ${DEEPSEEK_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages,
        stream: false,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(
        `DeepSeek proxy error ${res.status}: ${errorText.slice(0, 500)}`
      );
    }

    const data = await res.json();
    const message = data?.choices?.[0]?.message;
    // Reasoning models keep the final answer in `content`; fall back to the
    // reasoning text only if the final content is missing.
    const content = message?.content || message?.reasoning_content;

    if (!content) {
      throw new Error("DeepSeek proxy returned an empty response");
    }

    return content;
  } finally {
    clearTimeout(timer);
  }
};

const handleIndividualPrompt = async (prompt, options = {}) => {
  const system = options?.system;
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await callDeepSeek({ prompt, system });
    } catch (err) {
      lastError = err;
      const canRetry = attempt < MAX_RETRIES && isRetryableError(err);
      if (!canRetry) break;
    }
  }

  throw lastError;
};

export { handleIndividualPrompt };
