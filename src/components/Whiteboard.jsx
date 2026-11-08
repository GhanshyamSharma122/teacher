import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

// ── Layout constants ──────────────────────────────────────────────────────
const BOX_PAD_X = 28;
const BOX_PAD_Y = 16;
const BOX_MIN_W = 140;
const BOX_MIN_H = 64;
const FONT_SIZE = 16;
const FONT = `${FONT_SIZE}px Inter, system-ui, sans-serif`;
const GAP_X = 80;
const GAP_Y = 60;
const PAD = 60;

const CANVAS_VIEW_W = 1200;
const CANVAS_VIEW_H = 800;

// ── Measuring helpers ────────────────────────────────────────────────────
const measureCanvas = typeof OffscreenCanvas !== 'undefined'
  ? new OffscreenCanvas(1, 1).getContext('2d')
  : null;

function measureText(text, font = FONT) {
  const ctx = measureCanvas || document.createElement('canvas').getContext('2d');
  ctx.font = font;
  return ctx.measureText(text || '');
}

function getBoxSize(text) {
  const metrics = measureText(text, FONT);
  return {
    width: Math.max(BOX_MIN_W, Math.ceil(metrics.width) + BOX_PAD_X * 2),
    height: BOX_MIN_H,
  };
}

function getBBox(el) {
  if (el.type === 'box') {
    const { width, height } = getBoxSize(el.text);
    return { x: el.x || 0, y: el.y || 0, w: width, h: height };
  }
  if (el.type === 'text') {
    const metrics = measureText(el.text, `20px Inter, system-ui, sans-serif`);
    return { x: el.x || 0, y: el.y || 0, w: metrics.width, h: 24 };
  }
  return { x: el.x || 0, y: el.y || 0, w: 0, h: 0 };
}

// ── Auto-layout for the legacy simple schema ────────────────────────────
// Builds a clean layered layout from box/arrow connections. Only used when
// the AI returns the older <whiteboard> JSON instead of Mermaid.
function autoLayoutElements(elements, canvasW = CANVAS_VIEW_W, canvasH = CANVAS_VIEW_H) {
  if (!elements || elements.length === 0) return elements;

  const W = canvasW || CANVAS_VIEW_W;
  const H = canvasH || CANVAS_VIEW_H;
  const laid = elements.map(e => ({ ...e }));

  const nodeIndices = [];
  const arrows = [];

  laid.forEach((el, i) => {
    if (el.type === 'box') nodeIndices.push(i);
  });

  if (nodeIndices.length === 0) return laid;

  laid.forEach(el => {
    if (el.type === 'arrow' && el.from !== undefined && el.to !== undefined) {
      arrows.push({ from: Number(el.from), to: Number(el.to) });
    }
  });

  const nodeSizes = nodeIndices.map(i => {
    const bb = getBBox(laid[i]);
    return { w: bb.w, h: bb.h };
  });

  const origToNode = {};
  nodeIndices.forEach((origIdx, nodePos) => {
    origToNode[origIdx] = nodePos;
  });

  const n = nodeIndices.length;
  const adjOut = Array.from({ length: n }, () => []);
  const inDeg = new Array(n).fill(0);

  arrows.forEach(({ from, to }) => {
    const f = origToNode[from];
    const t = origToNode[to];
    if (f !== undefined && t !== undefined && f !== t) {
      adjOut[f].push(t);
      inDeg[t]++;
    }
  });

  const depth = new Array(n).fill(0);
  const queue = [];
  for (let i = 0; i < n; i++) {
    if (inDeg[i] === 0) queue.push(i);
  }

  const visited = new Set();
  while (queue.length > 0) {
    const u = queue.shift();
    visited.add(u);
    for (const v of adjOut[u]) {
      depth[v] = Math.max(depth[v], depth[u] + 1);
      inDeg[v]--;
      if (inDeg[v] === 0) queue.push(v);
    }
  }

  for (let i = 0; i < n; i++) {
    if (!visited.has(i)) {
      depth[i] = (Math.max(...depth) || 0) + 1;
    }
  }

  const maxDepth = Math.max(...depth, 0);
  const layers = Array.from({ length: maxDepth + 1 }, () => []);
  for (let i = 0; i < n; i++) {
    layers[depth[i]].push(i);
  }

  const layerWidths = layers.map(layer =>
    layer.length > 0 ? Math.max(...layer.map(i => nodeSizes[i].w)) : 0
  );
  const totalWidth = layerWidths.reduce((s, w) => s + w, 0) + (layers.length - 1) * GAP_X;
  const startX = Math.max(PAD, (W - totalWidth) / 2);
  const centerY = H / 2;

  let curX = startX;
  layers.forEach((layer, layerIdx) => {
    if (layer.length === 0) {
      curX += layerWidths[layerIdx] + GAP_X;
      return;
    }

    const colW = layerWidths[layerIdx];
    const colTotalH = layer.reduce((s, i) => s + nodeSizes[i].h, 0) + (layer.length - 1) * GAP_Y;
    let curY = centerY - colTotalH / 2;

    layer.forEach(nodePos => {
      const origIdx = nodeIndices[nodePos];
      const sz = nodeSizes[nodePos];
      laid[origIdx].x = curX + (colW - sz.w) / 2;
      laid[origIdx].y = curY;
      curY += sz.h + GAP_Y;
    });

    curX += colW + GAP_X;
  });

  if (arrows.length === 0 && nodeIndices.length > 1) {
    const maxNodeW = Math.max(...nodeSizes.map(s => s.w));
    const maxNodeH = Math.max(...nodeSizes.map(s => s.h));
    const cellW = maxNodeW + GAP_X;
    const cellH = maxNodeH + GAP_Y;
    const cols = Math.max(1, Math.min(nodeIndices.length, Math.floor((W - PAD * 2) / cellW)));
    const rows = Math.ceil(nodeIndices.length / cols);

    const gridW = cols * cellW - GAP_X;
    const gridH = rows * cellH - GAP_Y;
    const gridStartX = Math.max(PAD, (W - gridW) / 2);
    const gridStartY = Math.max(PAD, (H - gridH) / 2);

    nodeIndices.forEach((origIdx, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const sz = nodeSizes[i];
      laid[origIdx].x = gridStartX + col * cellW + (maxNodeW - sz.w) / 2;
      laid[origIdx].y = gridStartY + row * cellH + (maxNodeH - sz.h) / 2;
    });
  }

  nodeIndices.forEach((origIdx, i) => {
    const sz = nodeSizes[i];
    laid[origIdx].x = Math.max(PAD / 2, Math.min(W - sz.w - 10, laid[origIdx].x));
    laid[origIdx].y = Math.max(PAD / 2, Math.min(H - sz.h - 10, laid[origIdx].y));
  });

  return laid;
}

// ── Legacy simple AI format ↔ Excalidraw conversion ─────────────────────
// The old prompt used a small schema:
//   { type: "box", text, x, y }
//   { type: "text", text, x, y }
//   { type: "arrow", from: <index>, to: <index> }
// Kept so previously saved scenes and older models still work.

function simpleToExcalidrawElements(elements) {
  if (!Array.isArray(elements) || elements.length === 0) return [];

  const idByIndex = new Map();
  const skeleton = [];

  elements.forEach((el, index) => {
    if (el.type === 'box') {
      const id = `box-${index}`;
      idByIndex.set(index, id);
      const { width, height } = getBoxSize(el.text);
      const shape = ['rectangle', 'ellipse', 'diamond'].includes(el.shape) ? el.shape : 'rectangle';

      skeleton.push({
        type: shape,
        id,
        x: Number(el.x) || 0,
        y: Number(el.y) || 0,
        width,
        height,
        strokeColor: '#1e293b',
        backgroundColor: '#ffffff',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 1,
        roundness: { type: 3 },
        label: {
          text: el.text || 'Box',
          fontSize: FONT_SIZE,
          textAlign: 'center',
          verticalAlign: 'middle',
        },
      });
    } else if (el.type === 'text') {
      const id = `text-${index}`;
      idByIndex.set(index, id);
      skeleton.push({
        type: 'text',
        id,
        x: Number(el.x) || 0,
        y: Number(el.y) || 0,
        text: el.text || 'Text',
        fontSize: 20,
        strokeColor: '#1e293b',
      });
    }
  });

  elements.forEach((el, index) => {
    if (el.type !== 'arrow') return;
    const fromId = idByIndex.get(Number(el.from));
    const toId = idByIndex.get(Number(el.to));
    if (!fromId || !toId) return;

    skeleton.push({
      type: 'arrow',
      id: `arrow-${index}`,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      strokeColor: '#334155',
      strokeWidth: 2,
      start: { id: fromId },
      end: { id: toId },
    });
  });

  return convertToExcalidrawElements(skeleton, { regenerateIds: false });
}

function excalidrawToSimpleElements(elements) {
  const visible = (elements || []).filter(el => !el.isDeleted);
  const byId = new Map(visible.map(el => [el.id, el]));
  const simple = [];
  const idToIndex = new Map();

  const getBoundText = (el) => {
    const bound = el.boundElements?.find(item => item.type === 'text');
    if (!bound) return '';
    return byId.get(bound.id)?.text || '';
  };

  visible.forEach((el) => {
    if (el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'diamond') {
      const index = simple.length;
      simple.push({
        type: 'box',
        shape: el.type,
        text: getBoundText(el),
        x: el.x,
        y: el.y,
      });
      idToIndex.set(el.id, index);
    } else if (el.type === 'text' && !el.containerId) {
      const index = simple.length;
      simple.push({
        type: 'text',
        text: el.text || '',
        x: el.x,
        y: el.y,
      });
      idToIndex.set(el.id, index);
    }
  });

  visible.forEach((el) => {
    if (el.type !== 'arrow') return;
    const from = idToIndex.get(el.startBinding?.elementId);
    const to = idToIndex.get(el.endBinding?.elementId);
    if (from === undefined || to === undefined) return;
    simple.push({ type: 'arrow', from, to });
  });

  return simple;
}

// ── Mermaid → Excalidraw ─────────────────────────────────────────────────
// Mermaid is loaded lazily so the heavy layout engine only downloads when a
// diagram actually arrives. Mermaid's own layout engine positions the nodes,
// which is what keeps AI diagrams spread out instead of stacked.
async function mermaidToExcalidrawElements(definition) {
  const { parseMermaidToExcalidraw } = await import('@excalidraw/mermaid-to-excalidraw');
  const { elements, files } = await parseMermaidToExcalidraw(definition, {
    themeVariables: { fontSize: '16px' },
  });
  return {
    elements: convertToExcalidrawElements(elements),
    files,
  };
}

// Stable identity for an incoming AI scene.
function sceneKey(scene) {
  if (!scene) return 'empty';
  if (typeof scene.mermaid === 'string' && scene.mermaid.trim()) {
    return `mermaid:${scene.mermaid.trim()}`;
  }
  return `elements:${JSON.stringify(scene.elements || [])}`;
}

// ══════════════════════════════════════════════════════════════════════════
//  WHITEBOARD COMPONENT
// ══════════════════════════════════════════════════════════════════════════

export default function Whiteboard({ aiElements, onChange }) {
  const excalidrawAPI = useRef(null);
  const syncTimerRef = useRef(null);
  const lastAiKeyRef = useRef('');
  const pendingLocalKeyRef = useRef(null);
  const [isReady, setIsReady] = useState(false);

  // ── Hold-and-drag panning ──────────────────────────────────────────────
  const spaceHeldRef = useRef(false);
  const panModeRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panMode, setPanMode] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  useEffect(() => {
    const isEditableTarget = (target) => target instanceof HTMLElement && Boolean(
      target.closest('input, textarea, select, button, [contenteditable="true"]')
    );

    const handleKeyDown = (event) => {
      if (event.code === 'Escape') {
        panModeRef.current = false;
        setPanMode(false);
        return;
      }
      if (event.code !== 'Space' || event.repeat || isEditableTarget(event.target)) return;
      spaceHeldRef.current = true;
      setSpaceHeld(true);
    };
    const handleKeyUp = (event) => {
      if (event.code !== 'Space') return;
      spaceHeldRef.current = false;
      setSpaceHeld(false);
    };
    const handleBlur = () => {
      spaceHeldRef.current = false;
      setSpaceHeld(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const beginPan = useCallback((event) => {
    const api = excalidrawAPI.current;
    if (!api) return;

    const appState = api.getAppState();
    const zoom = appState.zoom?.value || 1;
    const startX = event.clientX;
    const startY = event.clientY;
    const startScrollX = appState.scrollX;
    const startScrollY = appState.scrollY;

    setIsPanning(true);
    document.body.classList.add('is-panning');

    const move = (e) => {
      api.updateScene({
        appState: {
          scrollX: startScrollX + (e.clientX - startX) / zoom,
          scrollY: startScrollY + (e.clientY - startY) / zoom,
        },
      });
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      setIsPanning(false);
      document.body.classList.remove('is-panning');
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }, []);

  // Space + drag, middle-mouse drag, or the "Hold to move" toggle.
  const handlePointerDownCapture = useCallback((event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('canvas')) return;

    const wantsPan = event.button === 1
      || (event.button === 0 && (spaceHeldRef.current || panModeRef.current));
    if (!wantsPan) return;

    event.preventDefault();
    event.stopPropagation();
    beginPan(event);
  }, [beginPan]);

  const togglePanMode = () => {
    const next = !panModeRef.current;
    panModeRef.current = next;
    setPanMode(next);
  };

  const [initialData] = useState(() => {
    const simple = Array.isArray(aiElements?.elements) ? aiElements.elements : [];
    return {
      elements: simpleToExcalidrawElements(autoLayoutElements(simple)),
      appState: {
        viewBackgroundColor: '#f8fafc',
        gridSize: 20,
      },
    };
  });

  const handleExcalidrawAPI = useCallback((api) => {
    excalidrawAPI.current = api;
    setIsReady(true);
  }, []);

  // Apply new AI scenes while avoiding a feedback loop with onChange.
  useEffect(() => {
    if (!isReady || !aiElements) return;

    const key = sceneKey(aiElements);
    if (key === lastAiKeyRef.current) return;
    if (key === pendingLocalKeyRef.current) {
      pendingLocalKeyRef.current = null;
      lastAiKeyRef.current = key;
      return;
    }
    lastAiKeyRef.current = key;

    const api = excalidrawAPI.current;
    if (!api) return;

    let cancelled = false;

    const applyScene = ({ elements, files }) => {
      if (cancelled) return;

      // Ignore the onChange that updateScene is about to emit.
      pendingLocalKeyRef.current = `elements:${JSON.stringify(excalidrawToSimpleElements(elements))}`;

      api.updateScene(files ? { elements, files } : { elements });
      requestAnimationFrame(() => {
        if (cancelled) return;
        api.scrollToContent(elements, {
          fitToContent: true,
          animate: true,
          duration: 300,
        });
      });
    };

    if (typeof aiElements.mermaid === 'string' && aiElements.mermaid.trim()) {
      mermaidToExcalidrawElements(aiElements.mermaid.trim())
        .then(applyScene)
        .catch((error) => {
          console.error('Could not render Mermaid diagram:', error);
          // Allow the same definition to be retried if it arrives again.
          lastAiKeyRef.current = '';
        });
    } else {
      const laidOut = autoLayoutElements(aiElements.elements || []);
      applyScene({ elements: simpleToExcalidrawElements(laidOut) });
    }

    return () => { cancelled = true; };
  }, [aiElements, isReady]);

  const handleChange = useCallback((elements) => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);

    syncTimerRef.current = setTimeout(() => {
      const simple = excalidrawToSimpleElements(elements);
      const key = `elements:${JSON.stringify(simple)}`;

      if (key === lastAiKeyRef.current || key === pendingLocalKeyRef.current) return;

      pendingLocalKeyRef.current = key;
      // Keep the Mermaid source so the AI always receives a Mermaid definition,
      // even after the user edits the rendered canvas by hand.
      const mermaid = typeof aiElements?.mermaid === 'string' && aiElements.mermaid.trim()
        ? aiElements.mermaid
        : '';
      onChange?.(mermaid ? { mermaid, elements: simple } : { elements: simple });
    }, 250);
  }, [onChange, aiElements]);

  useEffect(() => () => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
  }, []);

  return (
    <div
      className={`relative w-full h-full min-h-[320px] ${(panMode || spaceHeld) && !isPanning ? 'pan-ready' : ''} ${isPanning ? 'pan-active' : ''}`}
      onPointerDownCapture={handlePointerDownCapture}
    >
      <button
        type="button"
        onClick={(event) => {
          event.currentTarget.blur();
          togglePanMode();
        }}
        aria-pressed={panMode}
        className={`absolute bottom-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur-sm transition ${
          panMode
            ? 'border-brand-600 bg-brand-600 text-white'
            : 'border-slate-200 bg-white/90 text-slate-600 hover:border-brand-200 hover:text-brand-600'
        }`}
        title="Hold and drag the sheet to move it. You can also hold Space or the middle mouse button."
      >
        <span aria-hidden="true">✋</span>
        {panMode ? 'Drag to move' : 'Hold to move'}
      </button>

      <Excalidraw
        excalidrawAPI={handleExcalidrawAPI}
        initialData={initialData}
        onChange={handleChange}
        theme="light"
        UIOptions={{ welcomeScreen: false }}
      />
    </div>
  );
}
