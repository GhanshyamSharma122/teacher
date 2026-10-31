import React from 'react';

export default function Toolbar({ currentTool, setTool, onClear, onUndo, onRedo, zoom, onZoomIn, onZoomOut, onResetView }) {
  const tools = [
    { id: 'pan', icon: '✋', label: 'Pan' },
    { id: 'pen', icon: '✏️', label: 'Pen' },
    { id: 'rectangle', icon: '⬛', label: 'Box' },
    { id: 'arrow', icon: '↗️', label: 'Arrow' },
    { id: 'text', icon: '📝', label: 'Text' },
    { id: 'eraser', icon: '⌫', label: 'Eraser' }
  ];

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white px-2 py-2 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-slate-100 flex items-center space-x-2 z-10 backdrop-blur-sm bg-white/90">
      <div className="flex space-x-1 border-r border-slate-200 pr-2">
        {tools.map(t => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            title={t.label}
            aria-label={t.label}
            aria-pressed={currentTool === t.id}
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
          aria-label="Undo"
          className="w-10 h-10 rounded-xl flex items-center justify-center text-lg hover:bg-slate-100 text-slate-600 transition-all hover:scale-105"
        >
          ↩️
        </button>
        <button onClick={onRedo} title="Redo" aria-label="Redo" className="w-10 h-10 rounded-xl flex items-center justify-center text-lg hover:bg-slate-100 text-slate-600 transition-all">↪️</button>
        <button onClick={onZoomOut} title="Zoom out" aria-label="Zoom out" className="w-8 h-10 rounded-xl flex items-center justify-center text-sm hover:bg-slate-100 text-slate-600">−</button>
        <button onClick={onResetView} title="Reset view" aria-label="Reset view" className="min-w-12 h-10 rounded-xl flex items-center justify-center text-xs font-semibold hover:bg-slate-100 text-slate-600">{Math.round(zoom * 100)}%</button>
        <button onClick={onZoomIn} title="Zoom in" aria-label="Zoom in" className="w-8 h-10 rounded-xl flex items-center justify-center text-sm hover:bg-slate-100 text-slate-600">+</button>
        <button
          onClick={onClear}
          title="Clear Board"
          aria-label="Clear board"
          className="w-10 h-10 rounded-xl flex items-center justify-center text-lg hover:bg-red-50 text-red-500 transition-all hover:scale-105"
        >
          🗑️
        </button>
      </div>
    </div>
  );
}
