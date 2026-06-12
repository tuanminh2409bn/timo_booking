import React, { useRef, useEffect, useCallback } from 'react';

interface ClickSparkProps {
  sparkColor?: string;
  sparkSize?: number;
  sparkRadius?: number;
  sparkCount?: number;
  duration?: number;
  extraScale?: number;
  children?: React.ReactNode;
}

interface Spark {
  x: number; y: number; angle: number; startTime: number;
}

const ClickSpark: React.FC<ClickSparkProps> = ({
  sparkColor = '#1A1A1A', sparkSize = 10, sparkRadius = 15,
  sparkCount = 8, duration = 660, extraScale = 1.0, children,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparksRef = useRef<Spark[]>([]);

  const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

  const drawSpark = useCallback(
    (ctx: CanvasRenderingContext2D, spark: Spark, progress: number) => {
      const easedProgress = easeOutQuint(progress);
      const distance = easedProgress * sparkRadius * extraScale;
      const lineLength = sparkSize * (1 - easedProgress);
      const x = spark.x + Math.cos(spark.angle) * distance;
      const y = spark.y + Math.sin(spark.angle) * distance;
      const endX = x + Math.cos(spark.angle) * lineLength;
      const endY = y + Math.sin(spark.angle) * lineLength;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(endX, endY);
      ctx.strokeStyle = sparkColor; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.globalAlpha = 1 - easedProgress; ctx.stroke(); ctx.globalAlpha = 1;
    }, [sparkColor, sparkSize, sparkRadius, extraScale]
  );

  const animate = useCallback((timestamp: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    sparksRef.current = sparksRef.current.filter((spark) => {
      const elapsed = timestamp - spark.startTime;
      if (elapsed >= duration) return false;
      drawSpark(ctx, spark, elapsed / duration);
      return true;
    });
    if (sparksRef.current.length > 0) requestAnimationFrame(animate);
  }, [duration, drawSpark]);

  const handleClick = useCallback((e: globalThis.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const now = performance.now();
    const newSparks: Spark[] = Array.from({ length: sparkCount }, (_, i) => ({
      x, y, angle: (2 * Math.PI * i) / sparkCount, startTime: now,
    }));
    sparksRef.current.push(...newSparks);
    requestAnimationFrame(animate);
  }, [sparkCount, animate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const resizeCanvas = () => {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    parent.addEventListener('click', handleClick);
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      parent.removeEventListener('click', handleClick);
    };
  }, [handleClick]);

  return (
    <div style={{ position: 'relative' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9999 }} />
      {children}
    </div>
  );
};

export default ClickSpark;
