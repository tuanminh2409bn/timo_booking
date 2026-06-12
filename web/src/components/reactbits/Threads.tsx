import React, { useEffect, useRef } from 'react';
import './Threads.css';

interface ThreadsProps {
  color?: [number, number, number];
  amplitude?: number;
  distance?: number;
  enableMouseInteraction?: boolean;
  className?: string;
}

const Threads: React.FC<ThreadsProps> = ({
  color = [26, 26, 26],
  amplitude = 1,
  distance = 0,
  enableMouseInteraction = true,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const mouseRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const handleMouseMove = (e: globalThis.MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    if (enableMouseInteraction) canvas.addEventListener('mousemove', handleMouseMove);

    const threadCount = 30;
    let time = 0;

    const drawThread = (index: number) => {
      if (!ctx || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const baseY = h / 2 + (index - threadCount / 2) * (distance + 4);
      const opacity = 0.12 + (index / threadCount) * 0.23;

      ctx.beginPath();
      ctx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${opacity})`;
      ctx.lineWidth = 1.5;

      for (let x = 0; x < w; x++) {
        const mouseInfluence = enableMouseInteraction
          ? Math.sin((x - mouseRef.current.x) * 0.01 + (baseY - mouseRef.current.y) * 0.01) * 20
          : 0;
        const y = baseY +
          Math.sin(x * 0.004 + time + index * 0.5) * (30 * amplitude) +
          Math.sin(x * 0.002 + time * 0.5) * (20 * amplitude) +
          mouseInfluence;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    const animate = () => {
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      for (let i = 0; i < threadCount; i++) drawThread(i);
      time += 0.008;
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (enableMouseInteraction) canvas.removeEventListener('mousemove', handleMouseMove);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [color, amplitude, distance, enableMouseInteraction]);

  return <canvas ref={canvasRef} className={`threads-canvas ${className}`} />;
};

export default Threads;
