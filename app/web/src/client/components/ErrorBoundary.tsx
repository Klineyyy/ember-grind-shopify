import { Component, type ReactNode } from 'react';

/** Keeps a render error on one page from blanking the whole app; resets on navigation. */
export class ErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <s-page heading="Something went wrong">
        <s-banner tone="critical" heading="This page failed to load">
          {this.state.error.message}
        </s-banner>
      </s-page>
    );
  }
}
