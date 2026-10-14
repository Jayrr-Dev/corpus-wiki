"use client";

import { Component, type ReactNode } from "react";
import { ErrorFallback } from "./ErrorFallback";

// =====================================================================
// ERROR BOUNDARY (component level): keeps one crashing part, such as a
// wiki section or the side panel, from taking the whole page down.
// React only offers this as a class component (getDerivedStateFromError).
// Retry clears the error and renders the children again.
// =====================================================================

type ErrorBoundaryProps = { where: string; children: ReactNode };
type ErrorBoundaryState = { error: Error | null };

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  // A child threw while rendering: remember it and show the fallback
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  // Clears the error so the children render again
  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <ErrorFallback error={error} where={this.props.where} onRetry={this.retry} isCompact />;
  }
}
