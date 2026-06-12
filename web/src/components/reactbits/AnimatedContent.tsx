'use client';
import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';

interface AnimatedContentProps {
  children: React.ReactNode;
  distance?: number;
  direction?: 'vertical' | 'horizontal';
  reverse?: boolean;
  initialOpacity?: number;
  animateOpacity?: boolean;
  scale?: number;
  threshold?: number;
  delay?: number;
  className?: string;
}

const AnimatedContent: React.FC<AnimatedContentProps> = ({
  children, distance = 100, direction = 'vertical', reverse = false,
  initialOpacity = 0, animateOpacity = true, scale = 1,
  threshold = 0.1, delay = 0, className = '',
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, amount: threshold });

  const directions: Record<string, Record<string, number>> = {
    vertical: { y: reverse ? -distance : distance },
    horizontal: { x: reverse ? -distance : distance },
  };

  const initial = {
    ...(animateOpacity ? { opacity: initialOpacity } : {}),
    ...directions[direction],
    scale,
  };

  const animate = isInView ? { opacity: 1, x: 0, y: 0, scale: 1 } : initial;

  return (
    <motion.div
      ref={ref} initial={initial} animate={animate}
      transition={{ duration: 0.6, delay, ease: 'easeOut' }}
      className={className} style={{ willChange: 'transform, opacity' }}
    >
      {children}
    </motion.div>
  );
};

export default AnimatedContent;
