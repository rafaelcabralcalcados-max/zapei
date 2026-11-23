import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className={`inline-flex items-center justify-center gap-2 rounded-xl bg-[#0E7A34] text-white font-medium transition-colors hover:bg-[#0B5D27] whitespace-nowrap shrink-0 cursor-pointer ${
          compact ? 'px-3 py-2 text-xs min-h-[40px]' : 'w-full px-4 py-3 text-sm min-h-[44px]'
        }`}
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>Instalar ChatFi</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        className={`inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-[#0D2B3E] font-medium transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer ${
          compact ? 'px-3 py-2 text-xs min-h-[40px]' : 'w-full px-4 py-3 text-sm min-h-[44px]'
        }`}
      >
        <Smartphone className="w-4 h-4 shrink-0 text-[#0E7A34]" />
        <span>{isIOS ? 'Instalar no iPhone' : 'Instalar App (PWA)'}</span>
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D2B3E]/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-base font-bold text-[#0D2B3E]">Instalar ChatFi no aparelho</h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="min-h-[40px] min-w-[40px] -mt-2 -mr-2 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              {isIOS ? (
                <>
                  1. Toque no botão <strong>Compartilhar</strong> na barra do Safari.<br />
                  2. Role para baixo e selecione <strong>Adicionar à Tela de Início</strong>.
                </>
              ) : (
                <>
                  1. Abra o menu do navegador (ícone de três pontos ou barra de endereço).<br />
                  2. Selecione <strong>Instalar aplicativo</strong> ou <strong>Adicionar à tela inicial</strong> para abrir o ChatFi em tela cheia.
                </>
              )}
            </p>
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full min-h-[44px] rounded-xl bg-[#0E7A34] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0B5D27] cursor-pointer"
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 left-4 z-50 flex items-center gap-2 rounded-xl bg-[#0D2B3E] px-3.5 py-2 text-xs font-medium text-white shadow-lg">
      <WifiOff className="w-3.5 h-3.5 text-[#F97316]" />
      <span>Modo offline — exibindo dados em cache</span>
    </div>
  );
};
