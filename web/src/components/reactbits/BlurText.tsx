import { useSprings, animated, SpringValue } from '@react-spring/web';
import { useEffect, useRef, useState } from 'react';
import './BlurText.css';

interface BlurTextProps {
  text?: string;
  delay?: number;
  className?: string;
  animateBy?: 'words' | 'letters';
  direction?: 'top' | 'bottom' | 'left' | 'right';
  threshold?: number;
  rootMargin?: string;
  animationFrom?: Record<string, string | number>;
  animationTo?: Record<string, string | number>;
  onAnimationComplete?: () => void;
}

const BlurText: React.FC<BlurTextProps> = ({
  text = '',
  delay = 200,
  className = '',
  animateBy = 'words',
  direction = 'top',
  threshold = 0.1,
  rootMargin = '-100px',
  animationFrom,
  animationTo,
  onAnimationComplete,
}) => {
  const elements = animateBy === 'words' ? text.split(' ') : text.split('');
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  const animatedCount = useRef(0);

  const defaultFrom: Record<string, string | number> = {
    filter: 'blur(10px)',
    opacity: 0,
    transform:
      direction === 'top' ? 'translate3d(0,-50px,0)' :
      direction === 'bottom' ? 'translate3d(0,50px,0)' :
      direction === 'left' ? 'translate3d(-50px,0,0)' : 'translate3d(50px,0,0)',
  };

  const defaultTo: Record<string, string | number> = {
    filter: 'blur(0px)', opacity: 1, transform: 'translate3d(0,0,0)',
  };

  const from = animationFrom || defaultFrom;
  const to = animationTo || defaultTo;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); observer.unobserve(el); } },
      { threshold, rootMargin }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  const springs = useSprings(
    elements.length,
    elements.map((_, i) => ({
      from,
      to: inView ? { ...to, delay: i * delay } : from,
      onRest: () => {
        if (inView) {
          animatedCount.current += 1;
          if (animatedCount.current === elements.length && onAnimationComplete) {
            onAnimationComplete();
          }
        }
      },
    }))
  );

  return (
    <p ref={ref} className={`blur-text ${className}`}>
      {springs.map((props, index) => (
        <animated.span
          key={index}
          style={{
            display: 'inline-block',
            willChange: 'transform, filter, opacity',
            opacity: props.opacity as SpringValue<number>,
            transform: props.transform as SpringValue<string>,
            filter: props.filter as SpringValue<string>,
          }}
        >
          {elements[index]}{animateBy === 'words' && index < elements.length - 1 && ' '}
        </animated.span>
      ))}
    </p>
  );
};

export default BlurText;
