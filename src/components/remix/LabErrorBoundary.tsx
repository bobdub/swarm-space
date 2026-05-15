/**
 * LabErrorBoundary — Phase 6 Remix Lab stability.
 *
 * Catches render/draw exceptions inside the Lab canvas tree so a single
 * stroke crash never unmounts the route. Surfaces the failure as an
 * inline panel with a Reset button that remounts the children.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props { children: ReactNode; }
interface State { error: Error | null; nonce: number; }

export class LabErrorBoundary extends Component<Props, State> {
  state: State = { error: null, nonce: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn('[LabErrorBoundary] caught', error, info?.componentStack);
  }

  private reset = () => {
    this.setState((s) => ({ error: null, nonce: s.nonce + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="flex h-full flex-col items-center justify-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-center"
        >
          <AlertTriangle className="h-6 w-6 text-destructive" />
          <div className="text-xs text-muted-foreground">
            The Lab surface hit an error and was paused.
          </div>
          <code className="max-w-full overflow-hidden text-ellipsis text-[10px] text-destructive/80">
            {this.state.error.message}
          </code>
          <Button type="button" size="sm" variant="outline" onClick={this.reset} className="h-7 gap-1 text-[11px]">
            <RotateCcw className="h-3 w-3" />
            Reset Canvas
          </Button>
        </div>
      );
    }
    return <div key={this.state.nonce} className="contents">{this.props.children}</div>;
  }
}

export default LabErrorBoundary;