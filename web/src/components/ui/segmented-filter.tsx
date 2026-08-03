import { cn } from "@/lib/utils";

export type SegmentedFilterOption<T extends string> = {
  value: T;
  label: string;
};

type SegmentedFilterProps<T extends string> = {
  options: Array<SegmentedFilterOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
  itemClassName?: string;
};

export function SegmentedFilter<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  itemClassName,
}: SegmentedFilterProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "grid w-full overflow-hidden rounded-xl border border-blue-100 bg-blue-50/70 p-0.5 shadow-[0_6px_18px_rgba(15,23,42,0.08)]",
        className
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const isActive = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-10 min-w-0 truncate rounded-lg px-2 text-center text-sm font-semibold transition",
              isActive
                ? "bg-blue-700 text-white shadow-[0_4px_14px_rgba(29,78,216,0.24)]"
                : "text-slate-700 hover:bg-white/75 hover:text-blue-700",
              itemClassName
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
