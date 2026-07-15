"use client";

import * as React from "react";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * ScrollArea with a real mobile-scrollable viewport.
 *
 * Pitfall: Radix Viewport uses height:100%. If the root only has max-height
 * (no explicit height / flex min-h-0 parent), the viewport expands with content
 * and never scrolls — common on Android WebView bottom sheets. Force
 * overflow-y:auto + touch pan-y and min-height:0 so flex/max-height parents
 * can constrain it.
 */
function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative min-h-0 overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className={cn(
          "size-full min-h-0 rounded-[inherit]",
          "overflow-x-hidden overflow-y-auto overscroll-contain",
          "touch-pan-y [-webkit-overflow-scrolling:touch]",
          "transition-[color,box-shadow] outline-none",
          "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1",
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
