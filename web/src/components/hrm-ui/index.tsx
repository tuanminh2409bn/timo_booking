'use client';

import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

export const HRM_COLORS = {
  primary: '#0f62fe',
  primaryDark: '#0043ce',
  primaryLight: '#edf5ff',
  page: '#f3f6fc',
} as const;

export function HrmPageHeader({
  title,
  onBack,
  left,
  right,
  className,
}: {
  title: ReactNode;
  onBack?: () => void;
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('relative flex min-h-[76px] items-center bg-white px-4 py-4', className)}>
      <div className="z-10 flex h-11 w-11 shrink-0 items-center justify-start">
        {left ?? (onBack ? (
          <HrmIconButton aria-label="Quay lại" onClick={onBack}>
            <ChevronLeft className="h-6 w-6" />
          </HrmIconButton>
        ) : null)}
      </div>
      <h1 className="pointer-events-none absolute inset-0 flex items-center justify-center px-[4.5rem] text-center text-sm font-semibold text-slate-900">
        <span className="block min-w-0 max-w-full truncate whitespace-nowrap">{title}</span>
      </h1>
      <div className="z-10 ml-auto flex h-11 w-11 shrink-0 items-center justify-end">{right}</div>
    </header>
  );
}

export function HrmIconButton({ className, children, style, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-0 bg-white text-slate-600',
        'transition hover:bg-white active:scale-95',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hrm-blue-200)]',
        'disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100',
        className,
      )}
      style={{
        backgroundColor: '#fff',
        boxShadow: 'var(--hrm-shadow-header)',
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
}

export function HrmPrimaryIconButton({ className, children, style, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <HrmIconButton
      className={cn(
        'bg-[var(--hrm-blue-700)] text-white shadow-[0_8px_22px_rgba(29,78,216,0.28)]',
        'hover:bg-[var(--hrm-blue-800)]',
        className,
      )}
      style={{
        backgroundColor: 'var(--hrm-blue-700)',
        boxShadow: '0 8px 22px rgba(29, 78, 216, 0.28)',
        ...style,
      }}
      {...props}
    >
      {children}
    </HrmIconButton>
  );
}

export function HrmButton({
  variant = 'primary',
  size = 'default',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'default' | 'large' | 'icon';
}) {
  const variants = {
    primary: 'bg-[var(--hrm-blue-700)] text-white hover:bg-[var(--hrm-blue-800)]',
    secondary: 'border border-[var(--hrm-blue-100)] bg-[var(--hrm-blue-50)] text-[var(--hrm-blue-700)] hover:bg-[var(--hrm-blue-100)]',
    outline: 'border border-slate-200 bg-white text-slate-700 hover:bg-[var(--hrm-blue-50)] hover:text-[var(--hrm-blue-700)]',
    ghost: 'border border-transparent bg-transparent text-slate-700 hover:bg-[var(--hrm-blue-50)] hover:text-[var(--hrm-blue-700)]',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
  } as const;
  const sizes = {
    default: 'min-h-10 px-3.5 py-2',
    large: 'min-h-11 px-5 py-2.5',
    icon: 'h-10 w-10 p-0',
  } as const;

  return (
    <button
      type="button"
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hrm-blue-200)]',
        'disabled:pointer-events-none disabled:opacity-50 active:scale-[0.99]',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function HrmCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--hrm-border)] bg-white shadow-[var(--hrm-shadow-card)]',
        className,
      )}
      {...props}
    />
  );
}

export function HrmFeatureCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[1.75rem] border border-white/80 bg-white',
        'shadow-[0_12px_32px_-24px_rgba(15,23,42,0.55)]',
        className,
      )}
      {...props}
    />
  );
}

export function HrmInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-1 text-base text-slate-950',
        'outline-none transition placeholder:text-slate-400 focus:border-[var(--hrm-blue-400)] focus:ring-2 focus:ring-[var(--hrm-blue-100)]',
        'disabled:pointer-events-none disabled:opacity-50 md:text-sm',
        className,
      )}
      {...props}
    />
  );
}

export function HrmSegmentedFilter<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: Array<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid w-full overflow-hidden rounded-xl border border-[var(--hrm-blue-100)] bg-[color:rgba(237,245,255,0.7)] p-0.5',
        'shadow-[0_6px_18px_rgba(15,23,42,0.08)]',
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'min-h-10 min-w-0 truncate rounded-lg px-2 text-center text-sm font-semibold transition',
              active
                ? 'bg-[var(--hrm-blue-700)] text-white shadow-[0_4px_14px_rgba(29,78,216,0.24)]'
                : 'text-slate-700 hover:bg-white/75 hover:text-[var(--hrm-blue-700)]',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function HrmEmptyState({ icon, title, description, action, className }: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <HrmCard className={cn('flex min-h-44 flex-col items-center justify-center px-5 py-8 text-center', className)}>
      {icon ? <div className="mb-3 text-slate-400">{icon}</div> : null}
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm leading-5 text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </HrmCard>
  );
}
