/* global process */
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

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
      operations: ['replace', 'preserve-and-extend'],
      elements: ['box', 'text', 'arrow']
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

WHITEBOARD DRAWING RULES:
- Boxes auto-size to fit their text. Keep box labels SHORT (1-4 words max, e.g. "Client", "Web Server", "Database").
- Arrows connect box edges automatically. Use "from" and "to" as indices into the elements array.
- Space elements generously: at least 180px horizontal gap and 120px vertical gap between boxes.
- Start the first box at approximately x:80, y:100. Arrange in clear rows/columns.
- Use "text" type for standalone labels, titles, or annotations (not inside boxes).
- Valid drawing types are "box", "text", and "arrow". Arrows use zero-based element indices in "from" and "to".
- Keep the explanation readable without requiring the user to inspect the raw drawing payload.

To update the whiteboard, you MUST append a JSON block wrapped in <whiteboard> tags to the very end of your message.
Format example:
<whiteboard>
{
  "elements": [
    {"type": "text", "text": "How the Web Works", "x": 80, "y": 40},
    {"type": "box", "text": "Client", "x": 80, "y": 100},
    {"type": "box", "text": "Web Server", "x": 340, "y": 100},
    {"type": "box", "text": "Database", "x": 600, "y": 100},
    {"type": "arrow", "from": 1, "to": 2},
    {"type": "arrow", "from": 2, "to": 3}
  ]
}
</whiteboard>
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

  const provider = requestProvider || process.env.AI_PROVIDER || 'azure-openai';
  const messages = normalizeMessages(requestMessages);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const systemPrompt = getSystemInstruction(difficulty) +
      `\nCURRENT WHITEBOARD STATE (you can reuse these items to animate additions):\n` +
      JSON.stringify(whiteboardState || { elements: [] });

    if (provider === 'gemini') {
      await streamGemini(systemPrompt, messages, res);
    } else if (provider === 'openai' || provider === 'openai-compatible') {
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
