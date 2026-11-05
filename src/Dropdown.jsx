import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CaretDown, Check, MagnifyingGlass } from "@phosphor-icons/react";

// Long lists (people, departments) get a search box; short ones stay a plain list.
const SEARCH_FROM = 9;

// The app's own select: same look as the theme menu, keyboard friendly, no native browser popup.
// options: [{ value, label, depth? }]; value "" is the "all" choice.
export function Dropdown({ label, value, options, onChange, disabled = false, className = "" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [placement, setPlacement] = useState("below");
  const rootRef = useRef(null), triggerRef = useRef(null), listRef = useRef(null), searchRef = useRef(null);
  const listId = useId();
  const selected = options.find(option => option.value === value) ?? options[0];
  const searchable = options.length >= SEARCH_FROM;
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    return needle ? options.filter(option => option.label.toLocaleLowerCase("zh-CN").includes(needle)) : options;
  }, [options, query]);

  // Open upward when there is not enough room below, e.g. near the bottom of the drawer.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom, above = rect.top;
    setPlacement(below < 300 && above > below ? "above" : "below");
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    if (searchable) searchRef.current?.focus();
    else (listRef.current?.querySelector('[aria-selected="true"]') ?? listRef.current?.querySelector('[role="option"]'))?.focus();
    const onPointerDown = event => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, searchable]);

  const close = (refocus = true) => { setOpen(false); setQuery(""); if (refocus) triggerRef.current?.focus(); };
  const choose = option => { if (option.value !== value) onChange(option.value); close(); };
  const items = () => [...(listRef.current?.querySelectorAll('[role="option"]') ?? [])];
  const move = (from, step) => {
    const list = items();
    if (!list.length) return;
    const index = list.indexOf(from);
    list[index < 0 ? (step > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, index + step))].focus();
  };
  const onKeyDown = event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === "Tab") { close(false); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); move(document.activeElement, event.key === "ArrowDown" ? 1 : -1); return; }
    if (event.key === "Home" || event.key === "End") { if (event.target === searchRef.current) return; event.preventDefault(); const list = items(); list[event.key === "Home" ? 0 : list.length - 1]?.focus(); return; }
    if (event.key === "Enter" && event.target === searchRef.current && visible.length === 1) { event.preventDefault(); choose(visible[0]); }
  };
  const onTriggerKeyDown = event => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) { event.preventDefault(); setOpen(true); }
  };

  return <div className={`dropdown ${className}`.trim()} ref={rootRef} onKeyDown={open ? onKeyDown : undefined}>
    <button ref={triggerRef} type="button" className="dropdown__trigger" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      data-value={value} disabled={disabled} onClick={() => (open ? close() : setOpen(true))} onKeyDown={open ? undefined : onTriggerKeyDown}>
      <span className="dropdown__value">{selected?.label ?? ""}</span>
      <CaretDown className="dropdown__caret" weight="bold" aria-hidden="true" />
    </button>
    {open && <div className="dropdown__panel" data-placement={placement}>
      {searchable && <label className="dropdown__search"><MagnifyingGlass aria-hidden="true" /><input ref={searchRef} type="search" placeholder={`搜索${label}`} aria-label={`搜索${label}`} value={query} onChange={event => setQuery(event.target.value)} /></label>}
      <ul ref={listRef} id={listId} role="listbox" aria-label={label}>
        {visible.map(option => <li key={option.value} role="option" tabIndex={-1} aria-selected={option.value === value} style={option.depth ? { "--depth": option.depth } : undefined}
          onClick={() => choose(option)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(option); } }}>
          <span>{option.label}</span>{option.value === value && <Check weight="bold" aria-hidden="true" />}
        </li>)}
        {!visible.length && <li className="dropdown__empty" role="presentation">没有匹配的选项</li>}
      </ul>
    </div>}
  </div>;
}
