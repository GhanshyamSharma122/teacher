/* global process */
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { handleIndividualPrompt } from './src/utils/ai_service.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/capabilities', (_req, res) => {
  res.json({
    providers: ['azure-openai', 'gemini', 'openai-compatible'],
    harness: {
      whiteboard: true,
      diagramFormat: 'mermaid',
      operations: ['replace', 'preserve-and-extend'],
      elements: ['mermaid', 'box', 'text', 'arrow']
    }
  });
});

// ── Azure OpenAI helpers ────────────────────────────────────────────────────
const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
const azureApiKey = process.env.AZURE_OPENAI_API_KEY;
const azureDeployment = process.env.AZURE_OPENAI_DEPLOYMENT;
const azureApiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview';

// ── Gemini helpers ──────────────────────────────────────────────────────────
const geminiClient = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;
const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-04-17';
const openaiApiKey = process.env.OPENAI_API_KEY;
const openaiBaseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// ── Shared system instruction builder ───────────────────────────────────────
const getSystemInstruction = (difficulty) => `
You are an advanced AI Teacher.
Difficulty Level Chosen by User: ${difficulty}

Rules:
1. Explain concisely based on the difficulty level. Be extremely calm and highly encouraging. Use phrases like "Watch this...", "Here is why this clicks...", "Let me simplify that visually".
2. You can DRAW on the user's interactive whiteboard. Treat it as a tool/harness: use it whenever a diagram, sequence, comparison, geometry, or spatial explanation helps.
3. Evolution: The user will provide the CURRENT whiteboard state. Preserve useful existing elements and add or mutate only what is needed.
4. If you want to quiz the user, output questions in your text in this exact format:
<quiz>What is the port for HTTP?|80|443|8080</quiz>

DIAGRAM DRAWING RULES (use Mermaid):
- Whenever a diagram, flow, sequence, comparison, or spatial explanation helps, append exactly ONE Mermaid flowchart wrapped in <mermaid> tags at the very end of your message.
- Use "flowchart LR" for processes and architecture, and "flowchart TD" for hierarchies or decision trees.
- Mermaid lays the diagram out automatically, so never provide coordinates. Getting the syntax right matters more than the order of the statements.
- Keep node labels to 1-4 words. Use edge labels for actions, e.g. A -->|Request| B.
- 12 nodes maximum. Split bigger ideas into separate explanations.
- Use valid Mermaid syntax only. Do not use Markdown code fences inside the tags.
- If the user asks to extend or change the current diagram, return the FULL updated Mermaid definition, not a diff.

Format example:
<mermaid>
flowchart LR
  A[Client] -->|Request| B[Web Server]
  B -->|Query| C[(Database)]
  C -->|Rows| B
  B -->|Page| A
</mermaid>

- The whiteboard is rendered with Mermaid + Excalidraw, so the diagram stays editable.
- Never output a <whiteboard> JSON block when you output a <mermaid> block.
`;

const normalizeMessages = (messages) => (Array.isArray(messages) ? messages : [])
  .filter(message => message && typeof message.text === 'string' && message.text.trim())
  .slice(-24);

const sendSse = (res, payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

// ═══════════════════════════════════════════════════════════════════════════
//  Azure OpenAI streaming handler
// ═══════════════════════════════════════════════════════════════════════════
async function streamAzureOpenAI(systemPrompt, formattedMessages, res) {
  const url = `${azureEndpoint}/openai/deployments/${azureDeployment}/chat/completions?api-version=${azureApiVersion}`;

  const body = {
    messages: [
      { role: 'system', content: systemPrompt },
      ...formattedMessages.map(m => ({
        role: m.role === 'model' ? 'assistant' : m.role,
        content: m.text
      }))
    ],
    max_tokens: 2000,
    temperature: 0.7,
    stream: true
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': azureApiKey
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Azure OpenAI error ${response.status}: ${errorBody}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
        }
      } catch {
        // ignore malformed chunks
      }
    }
  }
}

async function streamOpenAICompatible(systemPrompt, formattedMessages, res, requestedBaseUrl) {
  if (!openaiApiKey) throw new Error('OPENAI_API_KEY is not configured.');
  const selectedBaseUrl = requestedBaseUrl || openaiBaseUrl;
  let safeBaseUrl;
  try {
    const parsedUrl = new URL(selectedBaseUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Endpoint must use HTTP or HTTPS.');
    safeBaseUrl = selectedBaseUrl.replace(/\/$/, '');
  } catch (error) {
    throw new Error(`Invalid OpenAI endpoint: ${error.message}`);
  }
  const response = await fetch(`${safeBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiApiKey}` },
    body: JSON.stringify({
      model: openaiModel,
      messages: [{ role: 'system', content: systemPrompt }, ...formattedMessages.map(m => ({
        role: m.role === 'model' ? 'assistant' : 'user', content: m.text
      }))],
      temperature: 0.7,
      max_tokens: 2000,
      stream: true
    })
  });
  if (!response.ok) throw new Error(`OpenAI-compatible provider error ${response.status}: ${await response.text()}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) sendSse(res, { text: delta });
      } catch { /* ignore incomplete provider frames */ }
    }
    if (done) break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  DeepSeek handler (uses the exact LLM calling code from "Study helper")
// ═══════════════════════════════════════════════════════════════════════════
async function streamDeepSeek(systemPrompt, formattedMessages, res) {
  const prompt = formattedMessages
    .map(m => `${m.role === 'model' ? 'assistant' : m.role}: ${m.text}`)
    .join('\n\n');

  const text = await handleIndividualPrompt(prompt, { system: systemPrompt });

  for (let i = 0; i < text.length; i += 200) {
    sendSse(res, { text: text.slice(i, i + 200) });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Gemini streaming handler
// ═══════════════════════════════════════════════════════════════════════════
async function streamGemini(systemPrompt, formattedMessages, res) {
  if (!geminiClient) {
    throw new Error('Gemini API key not configured. Set GEMINI_API_KEY in .env');
  }

  // Build Gemini conversation history (role must be 'user' or 'model')
  const contents = formattedMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : (m.role === 'model' ? 'model' : 'user'),
    parts: [{ text: m.text }]
  }));

  const response = await geminiClient.models.generateContentStream({
    model: geminiModel,
    contents,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 2000,
      temperature: 0.7
    }
  });

  for await (const chunk of response) {
    const text = chunk.text;
    if (text) {
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Chat endpoint — provider is chosen per-request or by env default
// ═══════════════════════════════════════════════════════════════════════════
app.post('/api/chat', async (req, res) => {
  const {
    messages: requestMessages,
    whiteboardState,
    difficulty = 'Intermediate',
    provider: requestProvider,
    openaiEndpoint
  } = req.body;

  let provider = requestProvider || process.env.AI_PROVIDER || 'openai-compatible';

  // DeepSeek is the default. If a stale client still asks for Azure OpenAI but
  // no Azure credentials are configured, fall back to the DeepSeek endpoint.
  if (provider === 'azure-openai' && (!azureEndpoint || !azureApiKey || !azureDeployment)) {
    provider = 'openai-compatible';
  }

  const messages = normalizeMessages(requestMessages);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const currentMermaid = typeof whiteboardState?.mermaid === 'string' ? whiteboardState.mermaid.trim() : '';
    const currentScene = currentMermaid
      ? `\nCURRENT DIAGRAM (Mermaid). Extend or replace it when the user asks for changes:\n${currentMermaid}\n`
      : `\nCURRENT WHITEBOARD ELEMENTS (legacy format):\n${JSON.stringify(whiteboardState || { elements: [] })}\n`;

    const systemPrompt = getSystemInstruction(difficulty) + currentScene;

    if (provider === 'gemini') {
      await streamGemini(systemPrompt, messages, res);
    } else if (provider === 'openai-compatible') {
      await streamDeepSeek(systemPrompt, messages, res);
    } else if (provider === 'openai') {
      await streamOpenAICompatible(systemPrompt, messages, res, openaiEndpoint);
    } else {
      // Default: Azure OpenAI
      await streamAzureOpenAI(systemPrompt, messages, res);
    }

    res.end();
  } catch (error) {
    console.error(`${provider} API Error:`, error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
