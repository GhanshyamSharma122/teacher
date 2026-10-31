const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export async function streamChat(messages, whiteboardState, difficulty, provider, onChunk, onError, signal, openaiEndpoint) {
  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, whiteboardState, difficulty, provider, openaiEndpoint }),
      signal
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || response.statusText);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('The AI server returned an empty response.');
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
          const parsed = JSON.parse(data);
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.text) onChunk(parsed.text);
        } catch (error) {
          onError(error.message || 'Could not parse the AI response.');
          return;
        }
      }
      if (done) break;
    }
  } catch (err) {
    if (err.name !== 'AbortError') onError(err.message || 'Unable to reach the AI server.');
  }
}
