import { useState, useEffect } from 'react'
import ChatPanel from './components/ChatPanel'
import Whiteboard from './components/Whiteboard'
import { streamChat } from './api'

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
  const [provider, setProvider] = useState(() => localStorage.getItem('ai_teacher_provider') || 'azure-openai');
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeTab, setActiveTab] = useState('chat'); // For mobile

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
    localStorage.setItem('ai_teacher_provider', provider);
  }, [provider]);

  const handleSendMessage = async (text, isVisualRequest = false) => {
    const newMessages = [...messages, { role: 'user', text }];
    setMessages(newMessages);
    setIsStreaming(true);

    let aiResponseText = "";
    setMessages(prev => [...prev, { role: 'model', text: '' }]);
    
    if (window.innerWidth < 1024 && !isVisualRequest) {
      setActiveTab('chat');
    }

    try {
      // Send CURRENT whiteboard state with request
      await streamChat(newMessages, aiWhiteboardData.elements, difficulty, provider, (chunk) => {
        aiResponseText += chunk;
        
        // Extract drawing instructions
        const tagStart = aiResponseText.indexOf('<whiteboard>');
        const tagEnd = aiResponseText.indexOf('</whiteboard>');
        
        if (tagStart !== -1 && tagEnd !== -1) {
          const jsonStr = aiResponseText.substring(tagStart + 12, tagEnd).trim();
          try {
             const parsed = JSON.parse(jsonStr);
             setAiWhiteboardData(parsed);
             if (window.innerWidth < 1024) {
               setActiveTab('whiteboard');
             }
          } catch(e) { console.error("Invalid whiteboard JSON", e); }
        }

        // Update the last message
        setMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'model', text: aiResponseText };
          return copy;
        });
      }, (error) => {
        console.error("Chat Error:", error);
        setMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'model', text: "Error: " + error };
          return copy;
        });
        setIsStreaming(false);
      });
    } catch (e) {
      console.error(e);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleClearHistory = () => {
     if (confirm('Clear all chat and whiteboard history?')) {
        setMessages([]);
        setAiWhiteboardData({ elements: [] });
        localStorage.removeItem('ai_teacher_messages');
        localStorage.removeItem('ai_teacher_whiteboard');
     }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-800 font-sans">
      {/* Mobile Tab Toggle */}
      <div className="lg:hidden absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center bg-white p-1 rounded-full shadow-lg border border-slate-200">
         <button onClick={() => setActiveTab('chat')} className={`px-6 py-2.5 rounded-full text-sm font-medium transition ${activeTab === 'chat' ? 'bg-brand-500 text-white shadow-sm' : 'text-slate-600'}`}>Chat</button>
         <button onClick={() => setActiveTab('whiteboard')} className={`px-6 py-2.5 rounded-full text-sm font-medium transition ${activeTab === 'whiteboard' ? 'bg-brand-500 text-white shadow-sm' : 'text-slate-600'}`}>Whiteboard</button>
      </div>

      <div className={`${isFocusMode ? 'hidden' : 'flex flex-col'} w-full lg:w-[40%] h-full flex-shrink-0 transition-all duration-300 ${activeTab !== 'chat' ? 'hidden lg:flex' : 'opacity-100 flex flex-col'}`}>
        <div className="bg-slate-50 px-4 py-2 text-xs border-b border-slate-200 flex justify-between items-center text-slate-500 flex-shrink-0 z-10">
           <div className="flex items-center space-x-3">
             <div className="flex items-center space-x-1">
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
             <div className="flex items-center space-x-1">
               <span>AI:</span>
               <select 
                 className="bg-transparent font-semibold text-brand-600 cursor-pointer outline-none" 
                 value={provider} 
                 onChange={(e) => setProvider(e.target.value)}
               >
                 <option value="azure-openai">Azure OpenAI</option>
                 <option value="gemini">Gemini</option>
               </select>
             </div>
           </div>
           <button onClick={handleClearHistory} className="hover:text-red-500 transition">Clear History</button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <ChatPanel 
             messages={messages} 
             onSendMessage={handleSendMessage} 
             isStreaming={isStreaming} 
          />
        </div>
      </div>

      <div className={`w-full ${isFocusMode ? 'lg:w-[100%]' : 'lg:w-[60%]'} h-full flex-shrink-0 transition-all duration-300 ${activeTab !== 'whiteboard' ? 'hidden lg:block' : 'opacity-100 flex flex-col'} relative`}>
        <button 
           onClick={() => setIsFocusMode(!isFocusMode)}
           className="absolute top-4 right-4 z-20 bg-white/90 backdrop-blur-sm p-2 rounded-xl shadow-sm border border-slate-200 text-slate-600 hover:text-brand-600 transition hover:scale-105 hidden lg:block"
           title="Toggle Focus Mode"
        >
          {isFocusMode ? '📖 Split View' : '🎯 Focus Mode'}
        </button>
        <Whiteboard aiElements={aiWhiteboardData} />
      </div>
    </div>
  )
}

export default App
