"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Toast host. Mounted once in the root layout; `toast()` from `sonner` is used
 * throughout the app for success/error feedback.
 */
export function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}
