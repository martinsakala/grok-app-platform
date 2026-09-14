import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorState } from "./states.js";

type Props = { children?: ReactNode; fallback?: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Intentionally empty — host loggers may wrap this later.
  }

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback ?? <ErrorState error={this.state.error} />;
    }
    return this.props.children ?? null;
  }
}
