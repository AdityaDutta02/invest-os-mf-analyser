import { AlertTriangle, X } from "lucide-react";

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div
      className="fixed bottom-6 right-6 z-50 max-w-sm bg-inverse rounded-sm anim-fade-up"
      style={{ boxShadow: "var(--shadow-3)" }}
      data-testid="error-toast"
      role="alert"
    >
      <div className="flex items-start gap-3 px-4 py-3 border-l-2 border-error">
        <AlertTriangle className="h-4 w-4 text-error shrink-0 mt-0.5" strokeWidth={2} />
        <div className="min-w-0">
          <div className="font-mono text-[10px] tracking-meta uppercase text-error mb-0.5">Ingestion error</div>
          <p className="font-mono text-[12px] text-fg-inverse leading-snug">{message}</p>
        </div>
        <button onClick={onClose} className="text-fg-inverse/60 hover:text-fg-inverse shrink-0" aria-label="Dismiss">
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
