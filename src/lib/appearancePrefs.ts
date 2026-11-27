export type ThemeMode = 'light' | 'dark';

export interface AppearancePrefs {
  theme: ThemeMode;
  customWallpaper: string | null;
  wallpaperDim: number; // 0..70 (%)
}

const STORAGE_KEY = 'chatfi_appearance_prefs_v1';
const WALLPAPER_STORAGE_KEY = 'chatfi_custom_wallpaper_v1';
export const APPEARANCE_EVENT = 'chatfi:appearance-changed';

const DEFAULT_PREFS: AppearancePrefs = {
  theme: 'light',
  customWallpaper: null,
  wallpaperDim: 22,
};

export function readAppearancePrefs(): AppearancePrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_PREFS };
  let theme: ThemeMode = 'light';
  let wallpaperDim = DEFAULT_PREFS.wallpaperDim;
  let customWallpaper: string | null = null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppearancePrefs>;
      if (parsed.theme === 'dark' || parsed.theme === 'light') {
        theme = parsed.theme;
      }
      if (typeof parsed.wallpaperDim === 'number' && Number.isFinite(parsed.wallpaperDim)) {
        wallpaperDim = Math.max(0, Math.min(70, Math.round(parsed.wallpaperDim)));
      }
    }
  } catch {
    // Ignore malformed storage
  }

  try {
    const savedImg = window.localStorage.getItem(WALLPAPER_STORAGE_KEY);
    if (savedImg && savedImg.startsWith('data:image/')) {
      customWallpaper = savedImg;
    }
  } catch {
    // Ignore storage access errors
  }

  return { theme, customWallpaper, wallpaperDim };
}

export function applyAppearanceToDom(prefs: AppearancePrefs): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const isDark = prefs.theme === 'dark';

  root.classList.toggle('dark', isDark);

  if (prefs.customWallpaper) {
    root.setAttribute('data-custom-wallpaper', '1');
    const safeUrl = prefs.customWallpaper.replace(/"/g, '\\"');
    root.style.setProperty('--chatfi-custom-wallpaper', `url("${safeUrl}")`);
    // Ensure slightly richer dim floor in dark mode for comfortable legibility
    const effectiveDim = isDark
      ? Math.max(0.32, Math.min(0.75, (prefs.wallpaperDim + 14) / 100))
      : Math.max(0, Math.min(0.7, prefs.wallpaperDim / 100));
    root.style.setProperty('--chatfi-wallpaper-dim', effectiveDim.toFixed(2));
  } else {
    root.removeAttribute('data-custom-wallpaper');
    root.style.removeProperty('--chatfi-custom-wallpaper');
    root.style.removeProperty('--chatfi-wallpaper-dim');
  }

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute('content', isDark ? '#0B141A' : '#043D1B');
  }
}

export function saveAppearancePrefs(next: AppearancePrefs): AppearancePrefs {
  const normalized: AppearancePrefs = {
    theme: next.theme === 'dark' ? 'dark' : 'light',
    customWallpaper:
      next.customWallpaper && next.customWallpaper.startsWith('data:image/')
        ? next.customWallpaper
        : null,
    wallpaperDim: Math.max(0, Math.min(70, Math.round(next.wallpaperDim))),
  };

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          theme: normalized.theme,
          wallpaperDim: normalized.wallpaperDim,
        })
      );
    } catch {
      // Ignore quota errors
    }

    try {
      if (normalized.customWallpaper) {
        window.localStorage.setItem(WALLPAPER_STORAGE_KEY, normalized.customWallpaper);
      } else {
        window.localStorage.removeItem(WALLPAPER_STORAGE_KEY);
      }
    } catch {
      throw new Error(
        'A imagem escolhida ficou grande demais para o armazenamento do navegador. Escolha uma foto menor.'
      );
    }
  }

  applyAppearanceToDom(normalized);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<AppearancePrefs>(APPEARANCE_EVENT, { detail: normalized }));
  }

  return normalized;
}

export function toggleThemeMode(): AppearancePrefs {
  const current = readAppearancePrefs();
  return saveAppearancePrefs({
    ...current,
    theme: current.theme === 'dark' ? 'light' : 'dark',
  });
}

export function initAppearancePrefs(): AppearancePrefs {
  const prefs = readAppearancePrefs();
  applyAppearanceToDom(prefs);
  return prefs;
}

/**
 * Compresses any chosen image file cleanly via canvas (max 1440px, JPEG 0.82)
 * so high-res phone photos look razor-sharp as chat wallpapers and save fast locally.
 */
export async function compressWallpaperImageFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Selecione um arquivo de imagem válido (JPG, PNG ou WebP).');
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('Imagem muito grande (limite de 20 MB).');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Não foi possível abrir a imagem selecionada.'));
      el.src = objectUrl;
    });

    const maxSide = 1440;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const width = Math.max(1, Math.round((img.naturalWidth || 720) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || 1280) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Seu navegador não conseguiu processar a imagem.');
    }
    ctx.drawImage(img, 0, 0, width, height);

    let dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    // If still > 1.8 MB in base64, step down quality slightly so localStorage never overflows
    if (dataUrl.length > 1_800_000) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.68);
    }
    if (dataUrl.length > 2_400_000) {
      const smallCanvas = document.createElement('canvas');
      smallCanvas.width = Math.max(1, Math.round(width * 0.72));
      smallCanvas.height = Math.max(1, Math.round(height * 0.72));
      const smallCtx = smallCanvas.getContext('2d');
      if (smallCtx) {
        smallCtx.drawImage(canvas, 0, 0, smallCanvas.width, smallCanvas.height);
        dataUrl = smallCanvas.toDataURL('image/jpeg', 0.7);
      }
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
