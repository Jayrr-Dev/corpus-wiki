"use client";

import { usePathname } from "next/navigation";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportClientError } from "@/lib/server-actions/errors";
import { ErrorFallback } from "./ErrorFallback";

// =====================================================================
// ERROR BOUNDARY (component level): keeps one crashing part, such as a
// wiki section, the sidebar, or one graph setting, from taking the page down.
// React only offers this as a class component (getDerivedStateFromError).
// Retry clears the error and renders the children again.
// resetKey clears it too, so a shell crash does not stick after you change pages.
// =====================================================================

type ErrorBoundaryProps = { where: string; children: ReactNode; resetKey?: string };
type ErrorBoundaryState = { error: Error | null };

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  // A child threw while rendering: remember it and show the fallback
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  // A new page should try the shell again. The boundary itself stays mounted.
  componentDidUpdate(prev: ErrorBoundaryProps) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  // Reports the crash with React's component stack, which names the component that threw
  componentDidCatch(error: Error, info: ErrorInfo) {
    void reportClientError({ where: this.props.where, message: error.message, path: window.location.pathname, stack: error.stack, componentStack: info.componentStack ?? undefined }).catch(() => {});
  }

  // Clears the error so the children render again
  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <ErrorFallback error={error} where={this.props.where} onRetry={this.retry} isCompact isReported />;
  }
}

// SHELL BOUNDARY: the sidebar and toasts stay mounted across pages, so a crash
// on one page should clear when you open another.
export function RoutedErrorBoundary({ where, children }: { where: string; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <ErrorBoundary where={where} resetKey={pathname}>
      {children}
    </ErrorBoundary>
  );
}
