import React, { useState, useEffect, useRef } from 'react';

const stripWhiteboardData = (text = '') => {
  const idx = text.indexOf('<whiteboard>');
  return idx === -1 ? text : text.substring(0, idx).trim();
};

const stripQuizData = (text = '') => text.replace(/<quiz>[\s\S]*?<\/quiz>/g, '').trim();

export default function ChatPanel({ messages, onSendMessage, isStreaming }) {
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const endRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth' });
  }, [messages, isStreaming]);

  // Read latest AI message aloud
  useEffect(() => {
    const speech = window.speechSynthesis;
    if (!speech) return;
    if (!isStreaming && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === 'model' && isSpeaking) {
         const textToRead = stripWhiteboardData(stripQuizData(lastMsg.text));
         if (textToRead) {
           speech.cancel();
           const utterance = new SpeechSynthesisUtterance(textToRead);
           speech.speak(utterance);
         }
      }
    }
  }, [isStreaming, messages, isSpeaking]);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const handleSubmit = (e) => {
    if(e) e.preventDefault();
    if (input.trim() && !isStreaming) {
      onSendMessage(input);
      setInput('');
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        setIsListening(false);
      }
    }
  };

  const toggleListen = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice recognition not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        setInput(prev => prev + (prev.length > 0 ? ' ' : '') + finalTranscript);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
    setIsListening(true);
  };

  const handleVisualRequest = () => {
    if (!isStreaming) {
      onSendMessage("Explain this visually to me.", true);
    }
  };

  const renderMessageContent = (text) => {
    let cleanText = stripWhiteboardData(text);
    
    // Parse Quiz Matches
    let quizMatch = cleanText.match(/<quiz>(.*?)<\/quiz>/);
    cleanText = stripQuizData(cleanText);

    return (
      <div className="flex flex-col space-y-2">
         <div className="whitespace-pre-wrap leading-relaxed text-[15px]">{cleanText}</div>
         {quizMatch && quizMatch[1] && (
           <div className="mt-3 p-3 bg-brand-50 border border-brand-100 rounded-xl">
             <p className="font-semibold text-sm mb-2 text-brand-800">⚡ Flash Quiz</p>
             {(() => {
                const parts = quizMatch[1].split('|');
                const question = parts[0];
                const answers = parts.slice(1);
                return (
                  <div>
                    <p className="text-sm mb-2 font-medium">{question}</p>
                    <div className="flex flex-wrap gap-2">
                       {answers.map((ans, i) => (
                         <button 
                           key={i}
                           onClick={() => onSendMessage(`My answer is: ${ans}`)}
                           className="px-3 py-1.5 text-xs bg-white border border-brand-200 text-brand-700 rounded-lg hover:bg-brand-500 hover:text-white transition"
                         >
                           {ans}
                         </button>
                       ))}
                    </div>
                  </div>
                );
             })()}
           </div>
         )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-white border-r border-slate-200">
      <div className="p-4 border-b border-slate-100 flex items-center justify-between shadow-sm z-10 transition-all">
        <div>
          <h1 className="text-xl font-bold text-slate-800 tracking-tight">AI Teacher</h1>
          <p className="text-xs text-slate-500 font-medium">Interactive Learning</p>
        </div>
        <div className="flex space-x-2">
          <button 
            onClick={() => {
              setIsSpeaking(!isSpeaking);
              if (isSpeaking) window.speechSynthesis?.cancel();
            }}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition shadow-sm ${isSpeaking ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
            title="Toggle Text-to-Speech"
          >
            {isSpeaking ? '🔊' : '🔈'}
          </button>
          <button 
            onClick={handleVisualRequest}
            disabled={isStreaming}
            className="text-xs px-3 py-1.5 bg-brand-50 text-brand-600 border border-brand-100 rounded-full font-medium hover:bg-brand-100 transition shadow-sm disabled:opacity-50"
          >
            ✨ Draw Concept
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-50 relative">
        {messages.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400 p-8 text-center flex-col">
             <div className="text-4xl mb-4">🎓</div>
             <p className="font-medium text-slate-600">Start learning something new.</p>
             <p className="text-sm mt-1">Try "Explain databases" or using the microphone to speak.</p>
             <div className="flex flex-wrap justify-center gap-2 mt-5">
               {['Explain with a diagram', 'Quiz me', 'Give me an example'].map(prompt => (
                 <button key={prompt} onClick={() => onSendMessage(prompt)} disabled={isStreaming}
                   className="px-3 py-2 text-xs font-medium rounded-full bg-white border border-slate-200 text-slate-600 hover:border-brand-300 hover:text-brand-600 transition">
                   {prompt}
                 </button>
               ))}
             </div>
          </div>
        )}
        {messages.map((m, i) => (
          (m.role === 'model' && !m.text && isStreaming) ? null :
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl p-3.5 shadow-sm ${
              m.role === 'user' 
                ? 'bg-brand-600 text-white rounded-tr-sm' 
                : 'bg-white border border-slate-100 text-slate-700 rounded-tl-sm'
            }`}>
              {renderMessageContent(m.text)}
            </div>
          </div>
        ))}
        {isStreaming && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-100 rounded-2xl rounded-tl-sm p-4 shadow-sm flex space-x-1.5 items-center h-10">
              <div className="w-2 h-2 bg-slate-400 rounded-full typing-dot"></div>
              <div className="w-2 h-2 bg-slate-400 rounded-full typing-dot"></div>
              <div className="w-2 h-2 bg-slate-400 rounded-full typing-dot"></div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="p-4 bg-white border-t border-slate-100">
        <form onSubmit={handleSubmit} className="relative">
          <input
            type="text"
            className={`w-full bg-slate-50 border rounded-full py-3 pl-5 pr-20 focus:outline-none focus:ring-2 focus:ring-brand-500 transition ${isListening ? 'border-brand-400 ring-2 ring-brand-100 shadow-inner' : 'border-slate-200'}`}
            placeholder={isListening ? "Listening..." : "Ask a question..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isStreaming}
          />
          <div className="absolute right-2 top-2 flex space-x-1">
            <button
               type="button"
               onClick={toggleListen}
               disabled={isStreaming}
               className={`p-2 rounded-full transition ${isListening ? 'text-red-500 bg-red-50 animate-pulse' : 'text-slate-400 hover:text-brand-500 hover:bg-slate-100'}`}
               title="Dictate"
            >
               <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                 <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
                 <path d="M6 10.5a.75.75 0 01.75.75v1.5a5.25 5.25 0 1010.5 0v-1.5a.75.75 0 011.5 0v1.5a6.751 6.751 0 01-6 6.709v2.291h3a.75.75 0 010 1.5h-7.5a.75.75 0 010-1.5h3v-2.291a6.751 6.751 0 01-6-6.709v-1.5A.75.75 0 016 10.5z" />
               </svg>
            </button>
            <button 
              type="submit" 
              disabled={!input.trim() || isStreaming}
              className="p-2 bg-brand-600 text-white rounded-full hover:bg-brand-500 disabled:opacity-50 disabled:hover:bg-brand-600 transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
