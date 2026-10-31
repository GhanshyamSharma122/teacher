import React from 'react';

export default function Toolbar({ currentTool, setTool, onClear, onUndo }) {
  const tools = [
    { id: 'pen', icon: '✏️', label: 'Pen' },
    { id: 'rectangle', icon: '⬛', label: 'Box' },
    { id: 'arrow', icon: '↗️', label: 'Arrow' },
    { id: 'text', icon: '📝', label: 'Text' }
  ];

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white px-2 py-2 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-slate-100 flex items-center space-x-2 z-10 backdrop-blur-sm bg-white/90">
      <div className="flex space-x-1 border-r border-slate-200 pr-2">
        {tools.map(t => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            title={t.label}
            className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all ${
              currentTool === t.id 
                ? 'bg-brand-100 text-brand-600 shadow-sm scale-105' 
                : 'hover:bg-slate-100 text-slate-600 hover:scale-105'
            }`}
          >
            {t.icon}
          </button>
        ))}
      </div>
      <div className="flex space-x-1 pl-1">
        <button
          onClick={onUndo}
          title="Undo"
          className="w-10 h-10 rounded-xl flex items-center justify-center text-lg hover:bg-slate-100 text-slate-600 transition-all hover:scale-105"
        >
          ↩️
        </button>
        <button
          onClick={onClear}
          title="Clear Board"
          className="w-10 h-10 rounded-xl flex items-center justify-center text-lg hover:bg-red-50 text-red-500 transition-all hover:scale-105"
        >
          🗑️
        </button>
      </div>
    </div>
  );
}
