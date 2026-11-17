// Autosaves the current canvas as a .excalidraw file through the local server
// (local-server/server.mjs). The canvas id lives in the URL as `?canvas=<id>`.
import { debounce, isTestEnv } from "@excalidraw/common";
import { loadFromBlob } from "@excalidraw/excalidraw/data/blob";
import { serializeAsJSON } from "@excalidraw/excalidraw/data/json";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

const API = "/api/canvases";
const SAVE_DEBOUNCE_MS = 1000;
// browsers cap keepalive request bodies at 64KB
const KEEPALIVE_MAX_BYTES = 60 * 1024;

export type CanvasInfo = { id: string; updatedAt: number };

export const isDiskSyncEnabled = !isTestEnv();

const pad = (n: number) => String(n).padStart(2, "0");

export const newCanvasId = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}-${Math.random().toString(36).slice(2, 6)}`;
};

export const canvasUrl = (id: string) =>
  `${window.location.origin}/?canvas=${encodeURIComponent(id)}`;

let canvasId: string | null = null;
// last JSON written (or loaded) for canvasId; null = no file on disk yet
let lastSavedJSON: string | null = null;

/** Reads `?canvas=` or assigns a fresh id and puts it in the URL. */
export const initCanvasId = () => {
  const id =
    new URLSearchParams(window.location.search).get("canvas") || newCanvasId();
  canvasId = id;
  lastSavedJSON = null;
  window.history.replaceState({}, "", canvasUrl(id) + window.location.hash);
  return id;
};

/** URL to return to after consuming one-off URL params (share links etc.). */
export const homeUrl = () =>
  canvasId ? canvasUrl(canvasId) : window.location.origin;

export const loadCanvas = async (localAppState: AppState | null) => {
  if (!canvasId) {
    return null;
  }
  const res = await fetch(`${API}/${encodeURIComponent(canvasId)}`);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Could not load canvas (${res.status})`);
  }
  const text = await res.text();
  lastSavedJSON = text;
  return loadFromBlob(new Blob([text]), localAppState, null);
};

const write = (id: string, json: string, keepalive: boolean) =>
  fetch(`${API}/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: json,
    keepalive: keepalive && json.length < KEEPALIVE_MAX_BYTES,
  });

let onSaveError: (error: Error) => void = console.error;
export const setSaveErrorHandler = (handler: (error: Error) => void) => {
  onSaveError = handler;
};

const persist = (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
  keepalive = false,
) => {
  const id = canvasId;
  if (!id) {
    return;
  }
  // don't create files for canvases that were never drawn on
  if (lastSavedJSON === null && !elements.some((el) => !el.isDeleted)) {
    return;
  }
  const json = serializeAsJSON(elements, appState, files, "local");
  if (json === lastSavedJSON) {
    return;
  }
  const previous = lastSavedJSON;
  lastSavedJSON = json;
  write(id, json, keepalive)
    .then((res) => {
      if (!res.ok) {
        throw new Error(`Saving to disk failed (${res.status})`);
      }
    })
    .catch((error: Error) => {
      // allow the next change to retry
      if (lastSavedJSON === json) {
        lastSavedJSON = previous;
      }
      onSaveError(error);
    });
};

let pending: Parameters<typeof persist> | null = null;

const persistPending = (keepalive: boolean) => {
  if (pending) {
    const [elements, appState, files] = pending;
    pending = null;
    persist(elements, appState, files, keepalive);
  }
};

const debouncedPersist = debounce(
  () => persistPending(false),
  SAVE_DEBOUNCE_MS,
);

export const saveCanvas = (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
) => {
  pending = [elements, appState, files];
  debouncedPersist();
};

/** Writes any pending change now; keepalive lets it survive page unload. */
export const flushCanvasSave = () => {
  debouncedPersist.cancel();
  persistPending(true);
};

export const listCanvases = async (): Promise<CanvasInfo[]> => {
  const res = await fetch(API);
  if (!res.ok) {
    throw new Error(`Could not list canvases (${res.status})`);
  }
  return res.json();
};
