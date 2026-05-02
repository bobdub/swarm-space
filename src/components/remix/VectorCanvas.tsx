/**
 * VectorCanvas — minimal HTML5 Canvas drawing surface for the Lab.
 *
 * SCAFFOLD STAGE — captures freehand strokes into an in-memory point
 * cloud and renders them. Element assignment, UQRC seeding, and live
 * `u(t)` projection arrive in a follow-up. No external drawing libs.
 *
 * No `<form>`. All buttons `type="button"`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Eraser } from 'lucide-react';

interface Point { x: number; y: number; pressure: number; }
interface Stroke { points: Point[]; color: string; }

interface VectorCanvasProps {
  strokeColor: string;
}

/**
 * Canvas 2D `strokeStyle` does NOT resolve CSS custom properties
 * (`hsl(var(--primary))` evaluates to an invalid color and silently breaks
 * the stroke pass — on some browsers the resulting NaN width crashes the
 * raster. Always feed a concrete hex/rgb to the context.
 */
const FALLBACK_STROKE = '#c084fc'; // soft primary, matches default theme

function safeStroke(color: string): string {
  if (!color) return FALLBACK_STROKE;
  if (color.startsWith('#') || color.startsWith('rgb')) return color;
  // Anything that includes a CSS variable cannot be drawn into a 2D canvas.
  if (color.includes('var(')) return FALLBACK_STROKE;
  return color;
}

export function VectorCanvas({ strokeColor }: VectorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<boolean>(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const currentRef = useRef<Stroke | null>(null);

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const all = currentRef.current ? [...strokes, currentRef.current] : strokes;
    for (const s of all) {
      ctx.strokeStyle = safeStroke(s.color);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < s.points.length; i++) {
        const p = s.points[i];
        ctx.lineWidth = Math.max(1.5, p.pressure * 6);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }, [strokes]);

  useEffect(() => { redraw(); }, [redraw]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => {
      const rect = c.getBoundingClientRect();
      c.width = Math.max(1, Math.floor(rect.width));
      c.height = Math.max(1, Math.floor(rect.height));
      redraw();
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, [redraw]);

  const startStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    currentRef.current = {
      color: safeStroke(strokeColor),
      points: [{ x: e.clientX - rect.left, y: e.clientY - rect.top, pressure: e.pressure || 0.5 }],
    };
    redraw();
  };
  const moveStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !currentRef.current) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    currentRef.current.points.push({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure || 0.5,
    });
    redraw();
  };
  const endStroke = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (currentRef.current && currentRef.current.points.length > 1) {
      setStrokes((prev) => [...prev, currentRef.current!]);
    }
    currentRef.current = null;
  };

  const clearAll = () => {
    setStrokes([]);
    currentRef.current = null;
  };

  return (
    <div role="form" aria-label="Lab vector canvas" className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        onPointerDown={startStroke}
        onPointerMove={moveStroke}
        onPointerUp={endStroke}
        onPointerLeave={endStroke}
        className="h-full w-full touch-none rounded-md border border-border/40 bg-background/40"
      />
      <div className="absolute right-2 top-2 flex gap-1">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Clear canvas"
          onClick={clearAll}
          className="h-7 w-7"
        >
          <Eraser className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export default VectorCanvas;