import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEventHandler, type ReactNode, type RefObject } from 'react';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';

const WINDOW_THRESHOLD = 200;

export function WindowedList<T extends { id: string }>({ items, selected, listRef, className, label, estimateSize, onClick, children, empty }: {
  items: T[]; selected?: string | null; listRef: RefObject<HTMLDivElement | null>;
  className: string; label: string; estimateSize: number; onClick: MouseEventHandler<HTMLDivElement>;
  children: (item: T, index: number) => ReactNode; empty?: ReactNode;
}) {
  const enabled = items.length >= WINDOW_THRESHOLD;
  const [focused, setFocused] = useState<string | null>(null);
  const pendingFocus = useRef<{ id: string; button: number } | null>(null);
  const focusedIndex = items.findIndex(item => item.id === focused);
  const selectedIndex = items.findIndex(item => item.id === selected);
  const getItemKey = useCallback((index: number) => items[index].id, [items]);
  const rangeExtractor = useCallback((range: Range) => {
    const indexes = new Set(defaultRangeExtractor(range));
    if (focusedIndex >= 0) indexes.add(focusedIndex);
    if (selectedIndex >= 0) indexes.add(selectedIndex);
    return [...indexes].sort((a, b) => a - b);
  }, [focusedIndex, selectedIndex]);
  const virtualizer = useVirtualizer({
    enabled, count: items.length, getScrollElement: () => listRef.current,
    estimateSize: () => estimateSize, getItemKey, overscan: 5, rangeExtractor
  });

  function finishFocus() {
    const pending = pendingFocus.current;
    if (!pending) return;
    const index = items.findIndex(item => item.id === pending.id);
    if (index < 0) { pendingFocus.current = null; return; }
    const row = listRef.current?.querySelector<HTMLElement>(`[data-list-index="${index}"]`);
    const buttons = row?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    if (!buttons?.length) return;
    const button = buttons[pending.button < 0 ? buttons.length - 1 : Math.min(pending.button, buttons.length - 1)];
    pendingFocus.current = null;
    button.focus({ preventScroll: true });
    button.scrollIntoView({ block: 'nearest' });
  }
  // A keyboard destination is kept in the rendered range before moving focus.
  // Keeping the old focused row also prevents wheel scrolling from losing it.
  useLayoutEffect(finishFocus);
  useEffect(() => {
    if (!enabled || !listRef.current) return;
    let width = listRef.current.clientWidth;
    const observer = new ResizeObserver(() => {
      const next = listRef.current?.clientWidth;
      if (next !== undefined && next !== width) {
        const anchor = virtualizer.getVirtualItems().find(row => row.end > (virtualizer.scrollOffset ?? 0));
        width = next;
        virtualizer.measure();
        if (anchor) virtualizer.scrollToIndex(anchor.index, { align: 'start' });
      }
    });
    observer.observe(listRef.current);
    return () => observer.disconnect();
  }, [enabled, listRef, virtualizer]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!enabled || event.altKey || event.ctrlKey || event.metaKey) return;
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    const row = button?.closest<HTMLElement>('[data-list-index]');
    if (!button || !row) return;
    const index = Number(row.dataset.listIndex);
    const buttons = [...row.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const position = buttons.indexOf(button);
    let next = index, nextButton = position;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Tab' && event.shiftKey && position === 0 && index > 0) { next--; nextButton = -1; }
    else if (event.key === 'Tab' && !event.shiftKey && position === buttons.length - 1 && index < items.length - 1) { next++; nextButton = 0; }
    else return;
    event.preventDefault();
    pendingFocus.current = { id: items[next].id, button: nextButton };
    setFocused(items[next].id);
    virtualizer.scrollToIndex(next, { align: 'auto' });
    finishFocus();
  }

  const rows = enabled ? virtualizer.getVirtualItems() : [];
  return <div className={className} ref={listRef} role="list" aria-label={`${label}, ${items.length}개`}
    data-item-count={items.length} data-windowed={enabled} onClick={onClick} onKeyDown={onKeyDown}
    onFocusCapture={event => {
      const row = (event.target as Element).closest<HTMLElement>('[data-list-index]');
      if (row) setFocused(items[Number(row.dataset.listIndex)]?.id ?? null);
    }} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null); }}>
    {enabled ? <div role="presentation" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {rows.map(row => <div key={row.key} className="windowed-item" data-index={row.index} data-list-index={row.index}
        role="listitem" aria-posinset={row.index + 1} aria-setsize={items.length} ref={virtualizer.measureElement}
        style={{ transform: `translateY(${row.start}px)` }}>{children(items[row.index], row.index)}</div>)}
    </div> : items.map((item, index) => <div key={item.id} role="listitem" data-list-index={index}
      aria-posinset={index + 1} aria-setsize={items.length}>{children(item, index)}</div>)}
    {!items.length && empty}
  </div>;
}
