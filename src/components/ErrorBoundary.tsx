// A crash in one page shows this instead of a white screen (P-68): the error, Copy and Reload.
// `resetKey` (the page's path) clears it, so going to another page works again.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Check, Copy, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = { children: ReactNode; resetKey?: string; full?: boolean };
type State = { error: Error | null; stack: string; copied: boolean };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: "", copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, copied: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ stack: info.componentStack ?? "" });
    console.error("Page crashed:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null, stack: "", copied: false });
  }

  private report() {
    const { error, stack } = this.state;
    return `${error?.name}: ${error?.message}\n${location.href}\n${new Date().toISOString()}\n${error?.stack ?? ""}\n${stack}`.trim();
  }

  private copy = async () => {
    try {
      await navigator.clipboard.writeText(this.report());
      this.setState({ copied: true });
    } catch { /* clipboard blocked: the text is on screen */ }
  };

  render() {
    const { error, copied } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={`flex items-center justify-center p-6 ${this.props.full ? "min-h-screen bg-background" : "h-[70vh]"}`}>
        <div className="w-full max-w-lg space-y-3 rounded-lg border border-destructive/40 bg-card p-5">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <span className="font-medium">Something broke</span>
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs text-muted-foreground" title={this.report()}>
            {error.message || String(error)}
          </pre>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={this.copy} title="Copy the error with its details">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button size="sm" variant="outline" onClick={() => location.reload()} title="Reload the page">
              <RotateCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
