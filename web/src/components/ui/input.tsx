import * as React from "react";

import { cn } from "@/lib/utils";
import { FORM_CONTROL_FOCUS_CLASS, FORM_CONTROL_SURFACE_CLASS } from "@/lib/uiTones";

const openNativePicker = (input: HTMLInputElement) => {
  const pickerInput = input as HTMLInputElement & { showPicker?: () => void };

  try {
    pickerInput.showPicker?.();
  } catch {
    // Some browsers only allow showPicker during direct user activation.
  }
};

const Input = ({ className, type, onClick, onFocus, ...props }: React.ComponentProps<"input">) => {
  const shouldOpenTimePicker = type === "time";

  return (
    <input
      type={type}
      data-slot="input"
      onClick={(event) => {
        onClick?.(event);

        if (!event.defaultPrevented && shouldOpenTimePicker) {
          openNativePicker(event.currentTarget);
        }
      }}
      onFocus={(event) => {
        onFocus?.(event);

        if (!event.defaultPrevented && shouldOpenTimePicker) {
          openNativePicker(event.currentTarget);
        }
      }}
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground min-h-11 w-full min-w-0 rounded-xl px-3 py-1 text-base transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        FORM_CONTROL_SURFACE_CLASS,
        FORM_CONTROL_FOCUS_CLASS,
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  );
};

export { Input };
