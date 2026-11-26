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
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);

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

  useEffect(() => {
    let cancelled = false;
    let activeTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
    const renderTasks: Array<{ cancel: () => void }> = [];

    const renderPdf = async () => {
      if (containerWidth <= 0) return;
      setLoading(true);
      setErrorMsg('');

      const host = pagesHostRef.current;
      if (host) {
        host.innerHTML = '';
      }

      try {
        const bytes = await decodeMediaUrlToUint8Array(mediaUrl);
        if (cancelled) return;

        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        activeTask = loadingTask;
        const activeDoc = await loadingTask.promise;
        if (cancelled) {
          await loadingTask.destroy();
          return;
        }

        const total = activeDoc.numPages;
        setPageCount(total);

        const availableWidth = Math.max(
          260,
          Math.min(820, containerWidth - 24)
        );
        const dpr = Math.min(window.devicePixelRatio || 1, 3);

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
          const renderViewport = page.getViewport({ scale: cssScale * dpr });

          const pageCard = document.createElement('div');
          pageCard.className =
            'mx-auto overflow-hidden rounded-lg bg-white shadow-md ring-1 ring-slate-300/70';
          pageCard.style.width = `${Math.floor(displayViewport.width)}px`;
          pageCard.style.maxWidth = 'none';

          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(renderViewport.width));
          canvas.height = Math.max(1, Math.floor(renderViewport.height));
          canvas.style.width = `${Math.floor(displayViewport.width)}px`;
          canvas.style.height = `${Math.floor(displayViewport.height)}px`;
          canvas.style.display = 'block';

          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }

          pageCard.appendChild(canvas);
          if (pagesHostRef.current && !cancelled) {
            pagesHostRef.current.appendChild(pageCard);
          }

          const task = page.render({
            canvas,
            viewport: renderViewport,
            background: '#ffffff',
          });
          renderTasks.push(task);
          await task.promise;
          page.cleanup();
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
      if (activeTask) {
        void activeTask.destroy();
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
            onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.25).toFixed(2))))}
            disabled={zoom <= 0.75}
            title="Diminuir zoom"
            aria-label="Diminuir zoom"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[44px] text-center font-mono text-[11px] font-semibold tabular-nums text-slate-700">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2, Number((z + 0.25).toFixed(2))))}
            disabled={zoom >= 2}
            title="Aumentar zoom"
            aria-label="Aumentar zoom"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable Rendered Pages */}
      <div
        ref={scrollContainerRef}
        className="relative min-h-0 flex-1 overflow-auto p-3 sm:p-5"
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
