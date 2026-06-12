'use client';
import { useEffect, useRef } from 'react';
import { useInView, useMotionValue, useSpring } from 'framer-motion';

interface CountUpProps {
  to: number;
  from?: number;
  direction?: 'up' | 'down';
  delay?: number;
  duration?: number;
  className?: string;
  startWhen?: boolean;
  separator?: string;
  onStart?: () => void;
  onEnd?: () => void;
}

export default function CountUp({
  to, from = 0, direction = 'up', delay = 0, duration = 2,
  className = '', startWhen = true, separator = '', onStart, onEnd,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(direction === 'down' ? to : from);
  const damping = 20 + 40 * (1 / duration);
  const stiffness = 100 * (1 / duration);
  const springValue = useSpring(motionValue, { damping, stiffness });
  const isInView = useInView(ref, { once: true, margin: '0px' });

  useEffect(() => {
    if (isInView && startWhen) {
      if (onStart) onStart();
      const timeoutId = setTimeout(() => { motionValue.set(direction === 'down' ? from : to); }, delay * 1000);
      const timeoutEndId = setTimeout(() => { if (onEnd) onEnd(); }, delay * 1000 + duration * 1000);
      return () => { clearTimeout(timeoutId); clearTimeout(timeoutEndId); };
    }
  }, [isInView, startWhen, delay, direction, from, to, motionValue, duration, onStart, onEnd]);

  useEffect(() => {
    const unsubscribe = springValue.on('change', (latest) => {
      if (ref.current) {
        const options: Intl.NumberFormatOptions = separator ? { useGrouping: true } : { useGrouping: false };
        const formattedNumber = Intl.NumberFormat('en-US', options).format(Number(latest.toFixed(0)));
        ref.current.textContent = separator ? formattedNumber.replace(/,/g, separator) : formattedNumber;
      }
    });
    return unsubscribe;
  }, [springValue, separator]);

  return <span className={className} ref={ref} />;
}
