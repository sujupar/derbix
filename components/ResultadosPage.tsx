// components/ResultadosPage.tsx
// Standalone Results page — promoted from tab to sidebar section
// Includes Error Boundary to prevent crashes from propagating

import React, { useState, Component } from 'react';
import ResultadosPublic from './live/ResultadosPublic';

class ResultsErrorBoundary extends Component<
    { children: React.ReactNode },
    { hasError: boolean; error: Error | null }
> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('[ResultadosPage] Error boundary caught:', error, info);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-16 h-16 bg-dx-loss/10 rounded-full flex items-center justify-center mb-4 border border-dx-loss/20">
                        <svg className="w-8 h-8 text-dx-loss" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                        </svg>
                    </div>
                    <h3 className="text-lg font-bold text-white mb-2">Error al cargar Resultados</h3>
                    <p className="text-dx-text-soft text-sm mb-4 max-w-md">
                        {this.state.error?.message || 'Ocurrio un error inesperado. Intenta recargar la pagina.'}
                    </p>
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })}
                        className="px-4 py-2 bg-dx-green/15 text-dx-green font-bold text-sm rounded-xl border border-dx-green/30 hover:bg-dx-green/25 transition-all"
                    >
                        Reintentar
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

const ResultadosPage: React.FC = () => {
    const [refreshKey, setRefreshKey] = useState(0);

    return (
        <ResultsErrorBoundary>
            <div className="space-y-6 animate-fade-in">
                <ResultadosPublic refreshTrigger={refreshKey} />
            </div>
        </ResultsErrorBoundary>
    );
};

export default ResultadosPage;
