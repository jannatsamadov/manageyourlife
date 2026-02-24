import { useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";

const MIN_DISPLAY_MS = 1800;

export function Toaster() {
  const { toasts, dismiss } = useToast();
  const [canDismiss, setCanDismiss] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (toasts.length > 0 && toasts.some((t) => t.open)) {
      setCanDismiss(false);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCanDismiss(true), MIN_DISPLAY_MS);
    } else {
      setCanDismiss(false);
    }
    return () => clearTimeout(timerRef.current);
  }, [toasts]);

  useEffect(() => {
    if (!canDismiss) return;
    const handler = () => {
      dismiss();
      setCanDismiss(false);
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [canDismiss, dismiss]);

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
