import { useEffect, useRef, useState } from "react";
import { Check, Monitor, Moon, Sun } from "@phosphor-icons/react";

export const THEME_OPTIONS = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
];

export function ThemeSwitcher({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const { icon: CurrentIcon } = THEME_OPTIONS.find((option) => option.value === value) ?? THEME_OPTIONS[2];

  useEffect(() => {
    if (!open) return undefined;
    rootRef.current.querySelector('[aria-checked="true"]')?.focus();
    const onPointerDown = (event) => { if (!rootRef.current.contains(event.target)) setOpen(false); };
    const onKeyDown = (event) => {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const onMenuKeyDown = (event) => {
    if (event.key === "Tab") { setOpen(false); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...rootRef.current.querySelectorAll('[role="menuitemradio"]')];
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(items.indexOf(document.activeElement) + step + items.length) % items.length].focus();
  };

  const choose = (option) => {
    onChange(option);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="theme-switcher" ref={rootRef}>
      <button ref={triggerRef} className="theme-switcher__trigger" type="button" title="界面颜色模式" aria-label="界面颜色模式" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <CurrentIcon aria-hidden="true" />
      </button>
      {open && (
        <div className="theme-switcher__menu" role="menu" aria-label="界面颜色模式" onKeyDown={onMenuKeyDown}>
          {THEME_OPTIONS.map(({ value: option, label, icon: Icon }) => (
            <button key={option} type="button" role="menuitemradio" aria-checked={value === option} onClick={() => choose(option)}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
              {value === option && <Check aria-hidden="true" weight="bold" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
