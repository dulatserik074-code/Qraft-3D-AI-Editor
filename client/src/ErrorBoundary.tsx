import { Component, type ErrorInfo, type ReactNode } from "react";
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    void error;
    void info;
    /* UI reports the failure without exposing stack traces. */
  }
  render() {
    return this.state.error ? (
      <main className="fatal">
        <h1>Редактор временно недоступен</h1>
        <p>
          Проект сохранён локально. Перезагрузите страницу, чтобы продолжить.
        </p>
        <button onClick={() => location.reload()}>Перезагрузить</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
