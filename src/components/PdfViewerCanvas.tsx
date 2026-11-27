import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Download, Loader2, ZoomIn, ZoomOut } from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

async function decodeMediaUrlToUint8Array(mediaUrl: string): Promise<Uint8Array> {
  if (mediaUrl.startsWith('data:')) {
    const commaIdx = mediaUrl.indexOf(',');
    if (commaIdx === -1) {
      throw new Error('URL de PDF inválida');
    }
    const header = mediaUrl.slice(0, commaIdx);
    const dataPart = mediaUrl.slice(commaIdx + 1);
    if (header.includes(';base64')) {
      const binary = atob(dataPart);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }
    const decoded = decodeURIComponent(dataPart);
    return new TextEncoder().encode(decoded);
  }

  const res = await fetch(mediaUrl);
  if (!res.ok) {
    throw new Error(`Falha ao ler PDF (${res.status})`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function renderPdfToPrintHtml(
  mediaUrl: string,
  title: string
): Promise<string> {
  const bytes = await decodeMediaUrlToUint8Array(mediaUrl);
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdfDoc = await loadingTask.promise;

  try {
    const pageImages: string[] = [];
    const totalPages = pdfDoc.numPages;
    // Use crisp resolution while keeping memory reasonable on multi-page PDFs
    const targetScale = totalPages > 12 ? 1.5 : 2.0;

    for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
      const page = await pdfDoc.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const maxWidthPx = 1800;
      const effectiveScale = Math.min(
        targetScale,
        baseViewport.width > 0 ? maxWidthPx / baseViewport.width : targetScale
      );
      const viewport = page.getViewport({ scale: Math.max(1, effectiveScale) });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      const renderTask = page.render({
        canvas,
        viewport,
        intent: 'print',
        background: '#ffffff',
      });
      await renderTask.promise;

      pageImages.push(canvas.toDataURL('image/png'));
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }

    const safeTitle = escapeHtml(title || 'Documento.pdf');
    const imgsHtml = pageImages
      .map(
        (src, idx) =>
          `<div class="page"><img src="${src}" alt="Página ${idx + 1}" /></div>`
      )
      .join('');

    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${safeTitle}</title>
<style>
  @page { margin: 0; }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
  }
  .page {
    margin: 0;
    padding: 0;
    page-break-after: always;
    break-after: page;
  }
  .page:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  img {
    display: block;
    width: 100%;
    height: auto;
    max-width: 100%;
  }
</style>
</head>
<body>${imgsHtml}</body>
</html>`;
  } finally {
    await loadingTask.destroy();
  }
}

const MIN_ZOOM = 0.75;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;
const MAX_CANVAS_AREA = 9_500_000;
const MAX_CANVAS_SIDE = 3600;

function clampZoom(value: number): number {
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  return Math.round(clamped * 100) / 100;
}

function computeSafeRenderScale(
  baseWidth: number,
  baseHeight: number,
  cssScale: number,
  desiredDpr: number
): number {
  const targetScale = cssScale * desiredDpr;
  const maxSide = Math.max(1, baseWidth, baseHeight);
  const sideCapScale = MAX_CANVAS_SIDE / maxSide;
  const area = Math.max(1, baseWidth * baseHeight);
  const areaCapScale = Math.sqrt(MAX_CANVAS_AREA / area);
  return Math.max(0.5, Math.min(targetScale, sideCapScale, areaCapScale));
}

interface PdfViewerCanvasProps {
  mediaUrl: string;
  fileName: string;
  onDownload?: () => void;
}

export const PdfViewerCanvas: React.FC<PdfViewerCanvasProps> = ({
  mediaUrl,
  fileName,
  onDownload,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pagesHostRef = useRef<HTMLDivElement | null>(null);
  const docCacheRef = useRef<{
    url: string;
    loadingTask: pdfjsLib.PDFDocumentLoadingTask;
    doc: pdfjsLib.PDFDocumentProxy;
  } | null>(null);
  const renderedUrlRef = useRef<string>('');
  const zoomRef = useRef<number>(1);
  const pendingFocalRef = useRef<{
    ratioX: number;
    ratioY: number;
    viewportOffsetX: number;
    viewportOffsetY: number;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);

  zoomRef.current = zoom;

  const updateZoomWithFocal = (
    nextZoomRaw: number,
    clientPoint?: { clientX: number; clientY: number }
  ) => {
    const nextZoom = clampZoom(nextZoomRaw);
    const container = scrollContainerRef.current;
    if (container && container.scrollWidth > 0 && container.scrollHeight > 0) {
      const rect = container.getBoundingClientRect();
      const viewportOffsetX = clientPoint
        ? Math.min(rect.width, Math.max(0, clientPoint.clientX - rect.left))
        : container.clientWidth / 2;
      const viewportOffsetY = clientPoint
        ? Math.min(rect.height, Math.max(0, clientPoint.clientY - rect.top))
        : container.clientHeight / 2;
      pendingFocalRef.current = {
        ratioX: (container.scrollLeft + viewportOffsetX) / Math.max(1, container.scrollWidth),
        ratioY: (container.scrollTop + viewportOffsetY) / Math.max(1, container.scrollHeight),
        viewportOffsetX,
        viewportOffsetY,
      };
    }
    setZoom((curr) => (curr === nextZoom ? curr : nextZoom));
  };

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return undefined;

    const updateWidth = () => {
      const nextWidth = el.clientWidth;
      if (nextWidth > 0) {
        setContainerWidth((prev) => (Math.abs(prev - nextWidth) > 8 ? nextWidth : prev));
      }
    };

    updateWidth();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateWidth);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Cleanup cached PDFDocumentProxy only when mediaUrl changes or unmounts
  useEffect(() => {
    return () => {
      const cached = docCacheRef.current;
      if (cached && cached.url !== mediaUrl) {
        docCacheRef.current = null;
        void cached.loadingTask.destroy();
      }
    };
  }, [mediaUrl]);

  useEffect(() => {
    return () => {
      const cached = docCacheRef.current;
      if (cached) {
        docCacheRef.current = null;
        void cached.loadingTask.destroy();
      }
    };
  }, []);

  // Two-finger pinch-to-zoom + double-tap zoom on mobile & desktop
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return undefined;

    let pinchActive = false;
    let startDist = 0;
    let startZoom = 1;
    let previewScale = 1;
    let midClientX = 0;
    let midClientY = 0;
    let lastTapAt = 0;
    let lastTapX = 0;
    let lastTapY = 0;

    const getTouchDist = (t1: Touch, t2: Touch) =>
      Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchActive = true;
        startDist = Math.max(10, getTouchDist(e.touches[0], e.touches[1]));
        startZoom = zoomRef.current;
        previewScale = 1;
        midClientX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        midClientY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const host = pagesHostRef.current;
        if (host) {
          const hostRect = host.getBoundingClientRect();
          const originX = Math.max(0, midClientX - hostRect.left);
          const originY = Math.max(0, midClientY - hostRect.top);
          host.style.transformOrigin = `${originX}px ${originY}px`;
        }
        e.preventDefault();
        return;
      }

      if (e.touches.length === 1 && !pinchActive) {
        const now = Date.now();
        const touch = e.touches[0];
        const dt = now - lastTapAt;
        const dist = Math.hypot(touch.clientX - lastTapX, touch.clientY - lastTapY);
        if (dt > 40 && dt < 300 && dist < 36) {
          lastTapAt = 0;
          const next = zoomRef.current > 1.3 ? 1 : 2.25;
          updateZoomWithFocal(next, { clientX: touch.clientX, clientY: touch.clientY });
          e.preventDefault();
        } else {
          lastTapAt = now;
          lastTapX = touch.clientX;
          lastTapY = touch.clientY;
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pinchActive || e.touches.length < 2) return;
      e.preventDefault();
      const dist = getTouchDist(e.touches[0], e.touches[1]);
      const rawRatio = dist / Math.max(10, startDist);
      const targetZoom = clampZoom(startZoom * rawRatio);
      previewScale = targetZoom / startZoom;
      midClientX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      midClientY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const host = pagesHostRef.current;
      if (host) {
        host.style.willChange = 'transform';
        host.style.transform = `scale(${previewScale})`;
      }
    };

    const finishPinch = () => {
      if (!pinchActive) return;
      pinchActive = false;
      const host = pagesHostRef.current;
      if (host) {
        host.style.transform = '';
        host.style.transformOrigin = '';
        host.style.willChange = '';
      }
      const nextZoom = clampZoom(startZoom * previewScale);
      if (Math.abs(nextZoom - zoomRef.current) >= 0.04) {
        updateZoomWithFocal(nextZoom, { clientX: midClientX, clientY: midClientY });
      }
    };

    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', finishPinch);
    container.addEventListener('touchcancel', finishPinch);

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', finishPinch);
      container.removeEventListener('touchcancel', finishPinch);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const renderTasks: Array<{ cancel: () => void }> = [];

    const renderPdf = async () => {
      if (containerWidth <= 0) return;
      setErrorMsg('');

      const host = pagesHostRef.current;
      const isNewDocument = renderedUrlRef.current !== mediaUrl;
      if (isNewDocument) {
        setLoading(true);
        if (host) {
          host.innerHTML = '';
        }
      }

      try {
        let activeDoc: pdfjsLib.PDFDocumentProxy;
        if (docCacheRef.current && docCacheRef.current.url === mediaUrl) {
          activeDoc = docCacheRef.current.doc;
        } else {
          if (docCacheRef.current) {
            const old = docCacheRef.current;
            docCacheRef.current = null;
            void old.loadingTask.destroy();
          }
          const bytes = await decodeMediaUrlToUint8Array(mediaUrl);
          if (cancelled) return;

          const loadingTask = pdfjsLib.getDocument({ data: bytes });
          const doc = await loadingTask.promise;
          if (cancelled) {
            await loadingTask.destroy();
            return;
          }
          docCacheRef.current = { url: mediaUrl, loadingTask, doc };
          activeDoc = doc;
        }

        const total = activeDoc.numPages;
        setPageCount(total);
        renderedUrlRef.current = mediaUrl;

        const availableWidth = Math.max(
          260,
          Math.min(820, containerWidth - 24)
        );
        const deviceDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const desiredDpr = Math.min(4, Math.max(deviceDpr, 2.5));

        const pagesMeta: Array<{
          page: pdfjsLib.PDFPageProxy;
          displayViewport: pdfjsLib.PageViewport;
          renderViewport: pdfjsLib.PageViewport;
        }> = [];

        for (let pageNum = 1; pageNum <= total; pageNum += 1) {
          if (cancelled) break;
          const page = await activeDoc.getPage(pageNum);
          if (cancelled) {
            page.cleanup();
            break;
          }
          const baseViewport = page.getViewport({ scale: 1 });
          const cssScale = (availableWidth / baseViewport.width) * zoom;
          const displayViewport = page.getViewport({ scale: cssScale });
          const safeRenderScale = computeSafeRenderScale(
            baseViewport.width,
            baseViewport.height,
            cssScale,
            desiredDpr
          );
          const renderViewport = page.getViewport({ scale: safeRenderScale });
          pagesMeta.push({ page, displayViewport, renderViewport });
        }

        if (cancelled || !pagesHostRef.current) {
          for (const item of pagesMeta) item.page.cleanup();
          return;
        }

        // Prepare/resize all page cards upfront so scroll geometry adjusts cleanly before painting canvases
        const cards: HTMLDivElement[] = [];
        const activeHost = pagesHostRef.current;
        for (let i = 0; i < pagesMeta.length; i += 1) {
          const { displayViewport } = pagesMeta[i];
          const existingCard = activeHost.children.item(i) as HTMLDivElement | null;
          const pageCard = existingCard || document.createElement('div');
          if (!existingCard) {
            pageCard.className =
              'mx-auto overflow-hidden rounded-lg bg-white shadow-md ring-1 ring-slate-300/70';
            activeHost.appendChild(pageCard);
          }
          const dispW = Math.max(1, Math.floor(displayViewport.width));
          const dispH = Math.max(1, Math.floor(displayViewport.height));
          pageCard.style.width = `${dispW}px`;
          pageCard.style.height = `${dispH}px`;
          pageCard.style.maxWidth = 'none';
          const oldCanvas = pageCard.querySelector('canvas');
          if (oldCanvas) {
            oldCanvas.style.width = `${dispW}px`;
            oldCanvas.style.height = `${dispH}px`;
          }
          cards.push(pageCard);
        }
        while (activeHost.children.length > pagesMeta.length) {
          activeHost.lastElementChild?.remove();
        }

        // Restore scroll focal point right after page cards resize
        const focal = pendingFocalRef.current;
        pendingFocalRef.current = null;
        const container = scrollContainerRef.current;
        if (focal && container) {
          container.scrollLeft = Math.max(
            0,
            focal.ratioX * container.scrollWidth - focal.viewportOffsetX
          );
          container.scrollTop = Math.max(
            0,
            focal.ratioY * container.scrollHeight - focal.viewportOffsetY
          );
        }

        // Render high-res vector canvases off-screen and swap cleanly in-place with zero blank flash
        for (let i = 0; i < pagesMeta.length; i += 1) {
          const { page, displayViewport, renderViewport } = pagesMeta[i];
          if (cancelled) {
            page.cleanup();
            continue;
          }

          const dispW = Math.max(1, Math.floor(displayViewport.width));
          const dispH = Math.max(1, Math.floor(displayViewport.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(renderViewport.width));
          canvas.height = Math.max(1, Math.floor(renderViewport.height));
          canvas.style.width = `${dispW}px`;
          canvas.style.height = `${dispH}px`;
          canvas.style.display = 'block';

          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }

          const task = page.render({
            canvas,
            viewport: renderViewport,
            background: '#ffffff',
          });
          renderTasks.push(task);

          try {
            await task.promise;
            if (!cancelled) {
              const card = cards[i];
              if (card) {
                card.replaceChildren(canvas);
              }
            } else {
              canvas.width = 0;
              canvas.height = 0;
            }
          } finally {
            page.cleanup();
          }
        }

        if (!cancelled) {
          setLoading(false);
        }
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error && err.name === 'RenderingCancelledException'
            ? ''
            : 'Não foi possível renderizar a prévia deste PDF aqui.';
        if (message) {
          setErrorMsg(message);
        }
        setLoading(false);
      }
    };

    void renderPdf();

    return () => {
      cancelled = true;
      for (const task of renderTasks) {
        try {
          task.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [mediaUrl, zoom, containerWidth]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-slate-200/85">
      {/* Subtle PDF zoom & page bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-300/70 bg-white/95 px-3 py-1.5 text-xs text-slate-700">
        <span className="font-medium text-slate-600">
          {pageCount > 0
            ? `${pageCount} ${pageCount === 1 ? 'página' : 'páginas'}`
            : 'Carregando PDF...'}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => updateZoomWithFocal(zoom - ZOOM_STEP)}
            disabled={zoom <= MIN_ZOOM}
            title="Diminuir zoom"
            aria-label="Diminuir zoom"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => updateZoomWithFocal(1)}
            title="Redefinir zoom para 100%"
            className="min-w-[46px] rounded px-1 py-0.5 text-center font-mono text-[11px] font-semibold tabular-nums text-slate-700 hover:bg-slate-100"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => updateZoomWithFocal(zoom + ZOOM_STEP)}
            disabled={zoom >= MAX_ZOOM}
            title="Aumentar zoom"
            aria-label="Aumentar zoom"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable Rendered Pages (supports two-finger crisp vector pinch-to-zoom) */}
      <div
        ref={scrollContainerRef}
        onDoubleClick={(e) => {
          const next = zoomRef.current > 1.3 ? 1 : 2.25;
          updateZoomWithFocal(next, { clientX: e.clientX, clientY: e.clientY });
        }}
        className="relative min-h-0 flex-1 overflow-auto touch-pan-x touch-pan-y p-3 sm:p-5"
      >
        {loading && pageCount === 0 && !errorMsg && (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2.5 text-slate-600">
            <Loader2 className="h-7 w-7 animate-spin text-[#0E7A34]" />
            <p className="text-xs font-medium">Abrindo {fileName}...</p>
          </div>
        )}

        {errorMsg ? (
          <div className="mx-auto mt-10 max-w-sm rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm">
            <p className="text-sm font-semibold text-slate-800">{errorMsg}</p>
            <p className="mt-1 text-xs text-slate-500">
              Você pode salvar o arquivo no aparelho ou usar o botão Imprimir acima.
            </p>
            {onDownload && (
              <button
                type="button"
                onClick={onDownload}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#0E7A34] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0B5D27]"
              >
                <Download className="h-4 w-4" />
                <span>Salvar PDF</span>
              </button>
            )}
          </div>
        ) : (
          <div ref={pagesHostRef} className="flex min-w-full w-max flex-col gap-3 pb-4" />
        )}
      </div>
    </div>
  );
};
