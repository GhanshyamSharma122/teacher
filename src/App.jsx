import { useState, useEffect, useRef } from 'react'
import ChatPanel from './components/ChatPanel'
import Whiteboard from './components/Whiteboard'
import { streamChat } from './api'

const DEFAULT_SPLIT_PCT = 42
const MIN_SPLIT_PCT = 25
const MAX_SPLIT_PCT = 75

/** Return the contents of the first complete <tag>...</tag> block, or null. */
function extractBlock(text, tag) {
  const open = `<${tag}>`
  const close = `</${tag}>`
  const start = text.indexOf(open)
  if (start === -1) return null
  const end = text.indexOf(close, start + open.length)
  if (end === -1) return null
  return text.slice(start + open.length, end).trim()
}

function App() {
  const [messages, setMessages] = useState(() => {
    try {
      const stored = localStorage.getItem('ai_teacher_messages');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  
  const [aiWhiteboardData, setAiWhiteboardData] = useState(() => {
    try {
      const stored = localStorage.getItem('ai_teacher_whiteboard');
      return stored ? JSON.parse(stored) : { elements: [] };
    } catch { return { elements: [] }; }
  });

  const [difficulty, setDifficulty] = useState(() => localStorage.getItem('ai_teacher_difficulty') || 'Intermediate');
  const [provider, setProvider] = useState(() => {
    const stored = localStorage.getItem('ai_teacher_provider_v2');
    localStorage.removeItem('ai_teacher_provider');
    return stored || 'openai-compatible';
  });
  const [openaiEndpoint, setOpenaiEndpoint] = useState(() => localStorage.getItem('ai_teacher_openai_endpoint_v2') || 'http://127.0.0.1:9655/v1');
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeTab, setActiveTab] = useState('chat'); // For mobile
  const [splitPct, setSplitPct] = useState(() => {
    const stored = Number(localStorage.getItem('ai_teacher_split_pct'));
    return Number.isFinite(stored) && stored >= MIN_SPLIT_PCT && stored <= MAX_SPLIT_PCT
      ? stored
      : DEFAULT_SPLIT_PCT;
  });
  const containerRef = useRef(null);
  const abortRef = useRef(null);
  const messageFrameRef = useRef(0);
  const streamedTextRef = useRef('');

  // Persist State
  useEffect(() => {
    localStorage.setItem('ai_teacher_messages', JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (aiWhiteboardData) {
      localStorage.setItem('ai_teacher_whiteboard', JSON.stringify(aiWhiteboardData));
    }
  }, [aiWhiteboardData]);

  useEffect(() => {
    localStorage.setItem('ai_teacher_difficulty', difficulty);
  }, [difficulty]);

  useEffect(() => {
    localStorage.setItem('ai_teacher_provider_v2', provider);
  }, [provider]);

  useEffect(() => {
    localStorage.setItem('ai_teacher_openai_endpoint_v2', openaiEndpoint);
  }, [openaiEndpoint]);

  useEffect(() => {
    localStorage.setItem('ai_teacher_split_pct', String(splitPct));
  }, [splitPct]);

  // ── Split-view divider drag ─────────────────────────────────────────────
  const handleDividerPointerDown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const move = (e) => {
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.min(MAX_SPLIT_PCT, Math.max(MIN_SPLIT_PCT, pct)));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      document.body.classList.remove('is-resizing');
    };

    document.body.classList.add('is-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  const handleDividerKeyDown = (event) => {
    const step = event.shiftKey ? 10 : 2;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setSplitPct(pct => Math.max(MIN_SPLIT_PCT, pct - step));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setSplitPct(pct => Math.min(MAX_SPLIT_PCT, pct + step));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setSplitPct(DEFAULT_SPLIT_PCT);
    }
  };

  const handleSendMessage = async (text, isVisualRequest = false) => {
    if (!text?.trim() || isStreaming) return;
    abortRef.current?.abort();
    const newMessages = [...messages, { role: 'user', text }];
    setMessages(newMessages);
    setIsStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    let aiResponseText = "";
    let lastDiagramKey = "";
    streamedTextRef.current = '';
    setMessages(prev => [...prev, { role: 'model', text: '' }]);
    
    if (window.innerWidth < 1024 && !isVisualRequest) {
      setActiveTab('chat');
    }

    try {
      // Send CURRENT whiteboard state with request
      await streamChat(newMessages, aiWhiteboardData, difficulty, provider, (chunk) => {
        aiResponseText += chunk;

        // Preferred drawing format: Mermaid. Mermaid's layout engine places
        // the nodes, so diagrams never stack in one spot.
        const mermaid = extractBlock(aiResponseText, 'mermaid');
        if (mermaid) {
          const key = `mermaid:${mermaid}`;
          if (key !== lastDiagramKey) {
            lastDiagramKey = key;
            setAiWhiteboardData({ mermaid });
            if (window.innerWidth < 1024) setActiveTab('whiteboard');
          }
        } else {
          // Legacy fallback: simple <whiteboard> JSON schema.
          const whiteboardJson = extractBlock(aiResponseText, 'whiteboard');
          if (whiteboardJson) {
            try {
              const parsed = JSON.parse(whiteboardJson);
              if (Array.isArray(parsed.elements)) {
                const key = `elements:${JSON.stringify(parsed.elements)}`;
                if (key !== lastDiagramKey) {
                  lastDiagramKey = key;
                  setAiWhiteboardData({ elements: parsed.elements });
                  if (window.innerWidth < 1024) setActiveTab('whiteboard');
                }
              }
            } catch {
              // Block is still streaming or malformed; try again on the next chunk.
            }
          }
        }

        // Throttle streamed text to one React update per animation frame.
        streamedTextRef.current = aiResponseText;
        if (!messageFrameRef.current) {
          messageFrameRef.current = requestAnimationFrame(() => {
            messageFrameRef.current = 0;
            setMessages(prev => {
              const copy = [...prev];
              if (copy.at(-1)?.role === 'model') copy[copy.length - 1] = { role: 'model', text: streamedTextRef.current };
              return copy;
            });
          });
        }
      }, (error) => {
        console.error("Chat Error:", error);
        setMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'model', text: "Error: " + error };
          return copy;
        });
        setIsStreaming(false);
      }, controller.signal, openaiEndpoint);
    } catch (e) {
      console.error(e);
    } finally {
      cancelAnimationFrame(messageFrameRef.current);
      messageFrameRef.current = 0;
      if (aiResponseText) {
        setMessages(prev => {
          const copy = [...prev];
          if (copy.at(-1)?.role === 'model') copy[copy.length - 1] = { role: 'model', text: aiResponseText };
          return copy;
        });
      }
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const handleClearHistory = () => {
     if (confirm('Clear all chat and whiteboard history?')) {
        abortRef.current?.abort();
        abortRef.current = null;
        setIsStreaming(false);
        setMessages([]);
        setAiWhiteboardData({ elements: [] });
        localStorage.removeItem('ai_teacher_messages');
        localStorage.removeItem('ai_teacher_whiteboard');
     }
  };

  const chatVisibility = isFocusMode
    ? 'hidden'
    : activeTab === 'chat' ? 'flex' : 'hidden lg:flex';

  const whiteboardVisibility = isFocusMode
    ? 'flex'
    : activeTab === 'whiteboard' ? 'flex' : 'hidden lg:flex';

  return (
    <div
      ref={containerRef}
      className="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-800 font-sans"
      style={{ '--chat-width': `${splitPct}%` }}
    >
      {/* Mobile Tab Toggle */}
      <div className="lg:hidden absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center bg-white p-1 rounded-full shadow-lg border border-slate-200">
         <button onClick={() => setActiveTab('chat')} className={`px-6 py-2.5 rounded-full text-sm font-medium transition ${activeTab === 'chat' ? 'bg-brand-500 text-white shadow-sm' : 'text-slate-600'}`}>Chat</button>
         <button onClick={() => setActiveTab('whiteboard')} className={`px-6 py-2.5 rounded-full text-sm font-medium transition ${activeTab === 'whiteboard' ? 'bg-brand-500 text-white shadow-sm' : 'text-slate-600'}`}>Whiteboard</button>
      </div>

      <div className={`${chatVisibility} flex-col h-full w-full lg:w-[var(--chat-width)] flex-shrink-0 min-w-0`}>
        <div className="bg-slate-50 px-3 py-2 text-xs border-b border-slate-200 flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500 flex-shrink-0 z-10">
           <div className="flex items-center gap-1 whitespace-nowrap">
             <span>Mode:</span>
             <select 
               className="bg-transparent font-semibold text-brand-600 cursor-pointer outline-none" 
               value={difficulty} 
               onChange={(e) => setDifficulty(e.target.value)}
             >
               <option value="Beginner">Beginner</option>
               <option value="Intermediate">Intermediate</option>
               <option value="Advanced">Advanced</option>
             </select>
           </div>
           <div className="flex items-center gap-1 whitespace-nowrap">
             <span>AI:</span>
             <select 
               className="bg-transparent font-semibold text-brand-600 cursor-pointer outline-none max-w-[9.5rem]" 
               value={provider} 
               onChange={(e) => setProvider(e.target.value)}
             >
               <option value="azure-openai">Azure OpenAI</option>
               <option value="gemini">Gemini</option>
               <option value="openai-compatible">OpenAI-compatible</option>
             </select>
           </div>
           {provider === 'openai-compatible' && (
             <input value={openaiEndpoint} onChange={e => setOpenaiEndpoint(e.target.value)}
               aria-label="OpenAI-compatible endpoint URL" title="OpenAI-compatible endpoint URL"
               className="min-w-40 flex-1 basis-40 bg-white border border-slate-200 rounded-md px-2 py-1 text-[11px] text-slate-600 outline-none focus:ring-2 focus:ring-brand-200"
               placeholder="https://api.openai.com/v1" />
           )}
           <button onClick={handleClearHistory} className="ml-auto whitespace-nowrap hover:text-red-500 transition">Clear History</button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <ChatPanel 
             messages={messages} 
             onSendMessage={handleSendMessage} 
             isStreaming={isStreaming} 
          />
        </div>
      </div>

      {/* Drag handle between chat and whiteboard */}
      {!isFocusMode && (
        <div
          role="separator"
          aria-label="Resize chat and whiteboard"
          aria-orientation="vertical"
          aria-valuemin={MIN_SPLIT_PCT}
          aria-valuemax={MAX_SPLIT_PCT}
          aria-valuenow={Math.round(splitPct)}
          tabIndex={0}
          onPointerDown={handleDividerPointerDown}
          onKeyDown={handleDividerKeyDown}
          onDoubleClick={() => setSplitPct(DEFAULT_SPLIT_PCT)}
          title="Drag to resize · double-click to reset"
          className={`hidden lg:flex group relative z-20 w-1.5 flex-shrink-0 cursor-col-resize touch-none items-center justify-center bg-slate-200 hover:bg-brand-200 focus:outline-none focus-visible:bg-brand-300 ${activeTab === 'chat' ? '' : 'lg:flex'}`}
        >
          <span className="pointer-events-none absolute inset-y-0 -inset-x-1.5" />
          <span className="h-10 w-1 rounded-full bg-slate-400 group-hover:bg-brand-500 transition-colors" />
        </div>
      )}

      <div className={`${whiteboardVisibility} flex-1 min-w-0 h-full relative`}>
        <button 
           onClick={() => setIsFocusMode(!isFocusMode)}
           className="absolute top-4 right-4 z-20 bg-white/90 backdrop-blur-sm p-2 rounded-xl shadow-sm border border-slate-200 text-slate-600 hover:text-brand-600 transition hover:scale-105 hidden lg:block"
           title="Toggle Focus Mode"
        >
          {isFocusMode ? '📖 Split View' : '🎯 Focus Mode'}
        </button>
          <Whiteboard aiElements={aiWhiteboardData} onChange={setAiWhiteboardData} />
      </div>
    </div>
  )
}

export default App
