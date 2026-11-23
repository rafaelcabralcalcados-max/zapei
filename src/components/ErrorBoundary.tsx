import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'Ocorreu um erro inesperado.',
    };
  }

  componentDidCatch(error: Error) {
    console.error('Zapei ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] p-6">
          <div className="max-w-md w-full rounded-2xl bg-white border border-slate-200 p-6 shadow-sm">
            <h2 className="text-lg font-bold text-[#0D2B3E]">Algo precisou ser recarregado</h2>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              O Zapei encontrou uma falha temporária ao processar os dados. Você pode retomar imediatamente sem perder sua navegação local.
            </p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, errorMessage: '' })}
              className="mt-5 w-full min-h-[44px] rounded-xl bg-[#0F5132] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0B3D26] cursor-pointer"
            >
              Voltar ao Zapei
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
