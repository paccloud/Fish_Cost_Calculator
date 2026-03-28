import React, { useState, useEffect } from 'react';
import { Download, X, Share } from 'lucide-react';

function isIosSafari() {
  const ua = navigator.userAgent;
  return /iP(hone|od|ad)/.test(ua) && /WebKit/.test(ua) && !/(CriOS|FxiOS|OPiOS|mercury)/.test(ua);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

const InstallPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (localStorage.getItem('installPromptDismissed')) return;

    // iOS Safari: no beforeinstallprompt, show manual instructions
    if (isIosSafari()) {
      setIsIos(true);
      setShowBanner(true);
      return;
    }

    // Chrome/Edge/Android: listen for native install prompt
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setShowBanner(false);
    if (outcome === 'accepted') {
      localStorage.setItem('installPromptDismissed', 'true');
    }
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem('installPromptDismissed', 'true');
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-navy border-t border-white/10 z-50">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-white/90 text-sm">
          {isIos ? (
            <>
              <Share className="h-5 w-5 text-teal shrink-0" />
              <span>
                Tap <Share className="inline h-4 w-4 text-teal" /> then "Add to Home Screen" to install
              </span>
            </>
          ) : (
            <>
              <Download className="h-5 w-5 text-teal shrink-0" />
              <span>Add Fish Calc to your home screen for offline use</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isIos && (
            <button
              onClick={handleInstall}
              className="bg-rust hover:bg-[#B8532A] text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors active:scale-[0.98]"
            >
              Install
            </button>
          )}
          <button
            onClick={handleDismiss}
            className="text-white/50 hover:text-white/80 p-1 transition-colors"
            aria-label="Dismiss install prompt"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default InstallPrompt;
