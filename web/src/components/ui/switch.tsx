import * as React from "react";

import { cn } from "@/lib/utils";

type SwitchProps = Omit<React.ComponentProps<"input">, "type">;

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      role="switch"
      className={cn(
        "h-8 w-[52px] cursor-pointer appearance-none rounded-full border border-slate-300 bg-slate-300 p-1 transition-colors",
        "before:block before:size-6 before:rounded-full before:bg-white before:shadow-sm before:transition-transform",
        "checked:border-teal-700 checked:bg-teal-700 checked:before:translate-x-5",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  ),
);
Switch.displayName = "Switch";

export { Switch };
export type { SwitchProps };
