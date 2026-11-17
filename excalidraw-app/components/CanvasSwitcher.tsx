import { useEffect, useState } from "react";
import { Dialog } from "@excalidraw/excalidraw/components/Dialog";

import { atom, useAtom } from "../app-jotai";
import {
  canvasUrl,
  flushCanvasSave,
  homeUrl,
  listCanvases,
  newCanvasId,
} from "../data/DiskSync";

import "./CanvasSwitcher.scss";

import type { CanvasInfo } from "../data/DiskSync";

export const openCanvasDialogAtom = atom(false);

/** Full navigation so the editor, history and caches start clean. */
const goToCanvas = (url: string) => {
  flushCanvasSave();
  window.location.assign(url);
};

export const openNewCanvas = () => goToCanvas(canvasUrl(newCanvasId()));

const formatTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

export const OpenCanvasDialog = () => {
  const [isOpen, setIsOpen] = useAtom(openCanvasDialogAtom);
  const [canvases, setCanvases] = useState<CanvasInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setCanvases(null);
    setError(null);
    listCanvases()
      .then(setCanvases)
      .catch((err: Error) => setError(err.message));
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const current = homeUrl();

  return (
    <Dialog
      size="small"
      title="Open canvas"
      onCloseRequest={() => setIsOpen(false)}
    >
      <div className="CanvasSwitcher">
        {error && <p className="CanvasSwitcher__message">{error}</p>}
        {!error && !canvases && (
          <p className="CanvasSwitcher__message">Loading…</p>
        )}
        {canvases?.length === 0 && (
          <p className="CanvasSwitcher__message">No saved canvases yet.</p>
        )}
        {!!canvases?.length && (
          <ul className="CanvasSwitcher__list">
            {canvases.map((canvas) => {
              const url = canvasUrl(canvas.id);
              const isCurrent = url === current;
              return (
                <li key={canvas.id}>
                  <button
                    type="button"
                    className="CanvasSwitcher__item"
                    disabled={isCurrent}
                    onClick={() => goToCanvas(url)}
                  >
                    <span className="CanvasSwitcher__name">
                      {canvas.id}
                      {isCurrent && " (open)"}
                    </span>
                    <span className="CanvasSwitcher__time">
                      {formatTime(canvas.updatedAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
};
