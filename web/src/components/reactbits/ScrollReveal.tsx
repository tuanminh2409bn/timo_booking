'use client';
import { useEffect, useRef, useMemo } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './ScrollReveal.css';

gsap.registerPlugin(ScrollTrigger);

interface ScrollRevealProps {
  children: string;
  enableBlur?: boolean;
  baseOpacity?: number;
  baseRotation?: number;
  blurStrength?: number;
  containerClassName?: string;
  textClassName?: string;
  rotationEnd?: string;
  wordAnimationEnd?: string;
}

const ScrollReveal: React.FC<ScrollRevealProps> = ({
  children, enableBlur = true, baseOpacity = 0.1, baseRotation = 3,
  blurStrength = 4, containerClassName = '', textClassName = '',
  rotationEnd = 'bottom bottom', wordAnimationEnd = 'bottom bottom',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const splitText = useMemo(() => {
    const text = typeof children === 'string' ? children : '';
    return text.split(/(\s+)/).map((word, index) => {
      if (word.match(/^\s+$/)) return <span key={index}>{word}</span>;
      return <span className="scroll-reveal-word" key={index}>{word}</span>;
    });
  }, [children]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    gsap.fromTo(el, { transformOrigin: '0% 50%', rotate: baseRotation }, {
      ease: 'none', rotate: 0,
      scrollTrigger: { trigger: el, start: 'top bottom', end: rotationEnd, scrub: true },
    });

    const wordElements = el.querySelectorAll('.scroll-reveal-word');
    gsap.fromTo(wordElements, {
      opacity: baseOpacity, filter: enableBlur ? `blur(${blurStrength}px)` : 'none',
    }, {
      ease: 'none', opacity: 1, filter: 'blur(0px)', stagger: 0.05,
      scrollTrigger: { trigger: el, start: 'top bottom-=20%', end: wordAnimationEnd, scrub: true },
    });

    return () => { ScrollTrigger.getAll().forEach((trigger) => trigger.kill()); };
  }, [enableBlur, baseOpacity, baseRotation, blurStrength, rotationEnd, wordAnimationEnd]);

  return (
    <div ref={containerRef} className={`scroll-reveal ${containerClassName}`}>
      <p className={textClassName}>{splitText}</p>
    </div>
  );
};

export default ScrollReveal;
