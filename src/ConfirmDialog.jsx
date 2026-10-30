import { useEffect, useRef } from "react";

// In-page replacement for window.confirm, which some embedded browsers dismiss silently.
export function ConfirmDialog({ title, message, confirmLabel, onClose }) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    cancelRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(false); return; }
      if (event.key !== "Tab") return;
      const buttons = [...dialogRef.current.querySelectorAll("button")];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [onClose]);
  return <>
    <button className="drawer-scrim confirm-scrim" type="button" tabIndex={-1} onClick={() => onClose(false)} aria-label="取消" />
    <div className="confirm-dialog" ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message">
      <h2 id="confirm-dialog-title">{title}</h2>
      <p id="confirm-dialog-message">{message}</p>
      <div className="confirm-dialog__actions">
        <button ref={cancelRef} className="secondary-button" type="button" onClick={() => onClose(false)}>取消</button>
        <button className="primary-button primary-button--small" type="button" onClick={() => onClose(true)}>{confirmLabel}</button>
      </div>
    </div>
  </>;
}
