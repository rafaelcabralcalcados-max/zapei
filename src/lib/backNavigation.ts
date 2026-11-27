import { useEffect, useRef } from 'react';

/**
 * Priority tiers for Android system Back button (◀), Android edge-swipe back,
 * and browser History Back navigation. Higher priority handlers always run first.
 */
export const BACK_PRIORITY = {
  SEARCH: 5,
  TAB: 10,
  PANEL_SUBTAB: 15,
  SCREEN: 20,
  SCREEN_SUBVIEW: 25,
  DRAWER: 30,
  MODAL: 40,
  LIGHTBOX: 50,
} as const;

interface BackHandlerEntry {
  id: number;
  priority: number;
  registeredAt: number;
  onBack: () => void;
}

const GUARD_KEY = '__chatfiBackGuard';
const GUARD_SEQ_KEY = '__chatfiGuardSeq';

let nextHandlerId = 1;
let guardSeq = 0;
let guardPushed = false;
let initialized = false;
let ignoringProgrammaticPop = false;
let ignoreResetTimer: number | null = null;
let emptyCleanupTimer: number | null = null;
let postPopSyncTimer: number | null = null;

const activeHandlers = new Map<number, BackHandlerEntry>();

function isGuardState(state: unknown): boolean {
  return Boolean(state && typeof state === 'object' && (state as Record<string, unknown>)[GUARD_KEY] === true);
}

function pushGuardState(): void {
  if (typeof window === 'undefined' || guardPushed) return;
  try {
    const currentState =
      window.history.state && typeof window.history.state === 'object'
        ? { ...(window.history.state as Record<string, unknown>) }
        : {};
    currentState[GUARD_KEY] = true;
    currentState[GUARD_SEQ_KEY] = ++guardSeq;
    window.history.pushState(currentState, '');
    guardPushed = true;
  } catch {
    // Ignore history API restrictions in exotic sandboxed contexts
  }
}

function cancelEmptyCleanup(): void {
  if (emptyCleanupTimer !== null) {
    window.clearTimeout(emptyCleanupTimer);
    emptyCleanupTimer = null;
  }
}

function scheduleEmptyCleanup(): void {
  cancelEmptyCleanup();
  if (typeof window === 'undefined') return;
  emptyCleanupTimer = window.setTimeout(() => {
    emptyCleanupTimer = null;
    if (activeHandlers.size > 0) return;
    if (guardPushed && isGuardState(window.history.state)) {
      ignoringProgrammaticPop = true;
      guardPushed = false;
      if (ignoreResetTimer !== null) {
        window.clearTimeout(ignoreResetTimer);
      }
      ignoreResetTimer = window.setTimeout(() => {
        ignoringProgrammaticPop = false;
        ignoreResetTimer = null;
      }, 450);
      try {
        window.history.back();
      } catch {
        ignoringProgrammaticPop = false;
      }
    } else {
      guardPushed = false;
    }
  }, 80);
}

function syncGuard(): void {
  if (typeof window === 'undefined') return;
  if (activeHandlers.size > 0) {
    cancelEmptyCleanup();
    if (!guardPushed) {
      pushGuardState();
    }
  } else if (guardPushed) {
    scheduleEmptyCleanup();
  }
}

function getTopHandler(): BackHandlerEntry | null {
  let top: BackHandlerEntry | null = null;
  for (const entry of activeHandlers.values()) {
    if (
      !top ||
      entry.priority > top.priority ||
      (entry.priority === top.priority && entry.registeredAt > top.registeredAt)
    ) {
      top = entry;
    }
  }
  return top;
}

function handlePopState(): void {
  if (ignoringProgrammaticPop) {
    ignoringProgrammaticPop = false;
    if (ignoreResetTimer !== null) {
      window.clearTimeout(ignoreResetTimer);
      ignoreResetTimer = null;
    }
    return;
  }

  // The browser just popped our guard entry (user pressed Android ◀ or edge-swiped back)
  guardPushed = false;
  cancelEmptyCleanup();

  const top = getTopHandler();
  if (!top) {
    // Already at root home screen — nothing to intercept
    return;
  }

  // If there are definitely more open layers beneath the top one, immediately
  // re-arm the guard synchronously so rapid double-taps on Android ◀ never exit the app.
  const hasLowerLayers = activeHandlers.size > 1;
  if (hasLowerLayers) {
    pushGuardState();
  }

  try {
    top.onBack();
  } catch {
    // Never let a handler exception break history synchronization
  }

  // After React commits the state change from `onBack()`, reconcile guard state.
  // This handles multi-step handlers (e.g. tab history) that remain active after onBack(),
  // as well as handlers that closed multiple layers at once.
  if (postPopSyncTimer !== null) {
    window.clearTimeout(postPopSyncTimer);
  }
  postPopSyncTimer = window.setTimeout(() => {
    postPopSyncTimer = null;
    syncGuard();
  }, 35);
}

function ensureInitialized(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  // Clean up any leftover guard marker from a previous reload so boot starts at root
  if (isGuardState(window.history.state)) {
    try {
      const cleaned = { ...(window.history.state as Record<string, unknown>) };
      delete cleaned[GUARD_KEY];
      delete cleaned[GUARD_SEQ_KEY];
      window.history.replaceState(cleaned, '');
    } catch {
      // ignore
    }
  }

  window.addEventListener('popstate', handlePopState);
}

/**
 * Registers a back-navigation handler while `active` is true.
 * Works automatically with Android's system Back button (◀), Android back-gesture,
 * and browser Back button.
 *
 * @param active    Whether this screen/modal/layer is currently open.
 * @param onBack    Callback executed when the user presses Back while this is the topmost layer.
 * @param priority  Layer priority (higher closes first). Use `BACK_PRIORITY.*`.
 * @param stepKey   Optional key that changes when a multi-step view steps backward while staying active.
 */
export function useSystemBackHandler(
  active: boolean,
  onBack: () => void,
  priority: number = BACK_PRIORITY.MODAL,
  stepKey?: string | number
): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!active) return;
    ensureInitialized();

    const id = nextHandlerId++;
    activeHandlers.set(id, {
      id,
      priority,
      registeredAt: Date.now() + id * 0.001,
      onBack: () => onBackRef.current(),
    });
    syncGuard();

    return () => {
      activeHandlers.delete(id);
      syncGuard();
    };
  }, [active, priority, stepKey]);
}
