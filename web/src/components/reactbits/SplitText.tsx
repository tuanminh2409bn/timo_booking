import { useSprings, animated, SpringValue } from '@react-spring/web';
import { useEffect, useRef, useState } from 'react';
import './SplitText.css';

interface SplitTextProps {
  text?: string;
  className?: string;
  delay?: number;
  animationFrom?: Record<string, string | number>;
  animationTo?: Record<string, string | number>;
  threshold?: number;
  rootMargin?: string;
  textAlign?: 'left' | 'center' | 'right';
  onLetterAnimationComplete?: () => void;
}

const SplitText: React.FC<SplitTextProps> = ({
  text = '',
  className = '',
  delay = 100,
  animationFrom = { opacity: 0, transform: 'translate3d(0,40px,0)' },
  animationTo = { opacity: 1, transform: 'translate3d(0,0,0)' },
  threshold = 0.1,
  rootMargin = '-100px',
  textAlign = 'center',
  onLetterAnimationComplete,
}) => {
  const words = text.split(' ').map((word) => word.split(''));
  const letters = words.flat();
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  const animatedCount = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) { setInView(true); observer.unobserve(el); }
      },
      { threshold, rootMargin }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  const springs = useSprings(
    letters.length,
    letters.map((_, i) => ({
      from: animationFrom,
      to: inView ? { ...animationTo, delay: i * delay } : animationFrom,
      onRest: () => {
        if (inView) {
          animatedCount.current += 1;
          if (animatedCount.current === letters.length && onLetterAnimationComplete) {
            onLetterAnimationComplete();
          }
        }
      },
    }))
  );

  let letterIndex = 0;

  return (
    <p ref={ref} className={`split-text ${className}`} style={{ textAlign, overflow: 'hidden' }}>
      {words.map((word, wordIndex) => (
        <span key={wordIndex} style={{ display: 'inline-block', whiteSpace: 'pre' }}>
          {word.map((letter) => {
            const currentIndex = letterIndex++;
            return (
              <animated.span
                key={currentIndex}
                style={{
                  display: 'inline-block',
                  willChange: 'transform, opacity',
                  opacity: springs[currentIndex].opacity as SpringValue<number>,
                  transform: springs[currentIndex].transform as SpringValue<string>,
                }}
              >
                {letter}
              </animated.span>
            );
          })}
          {wordIndex < words.length - 1 && <span style={{ display: 'inline-block' }}>&nbsp;</span>}
        </span>
      ))}
    </p>
  );
};

export default SplitText;
