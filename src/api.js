export async function streamChat(messages, whiteboardState, difficulty, provider, onChunk, onError) {
  try {
    const response = await fetch('http://localhost:3001/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, whiteboardState, difficulty, provider })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || response.statusText);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      const chunkStr = decoder.decode(value, { stream: true });
      const lines = chunkStr.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              onError(parsed.error);
              return;
            }
            if (parsed.text) {
              onChunk(parsed.text);
            }
          } catch (e) {
            console.error("Error parsing message stream:", data, e);
          }
        }
      }
    }
  } catch (err) {
    onError(err.message);
  }
}
