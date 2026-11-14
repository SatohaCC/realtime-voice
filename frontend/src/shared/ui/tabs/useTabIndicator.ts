import { type RefObject, useLayoutEffect } from "react";

/** DOMの選択状態・寸法と、伸縮するインジケーターを同期する。 */
export function useTabIndicator(
  listRef: RefObject<HTMLDivElement | null>,
  variant: "primary" | "secondary",
) {
  useLayoutEffect(() => {
    const list = listRef.current;
    const indicator = list?.querySelector<HTMLElement>("[data-tab-indicator]");
    if (!list || !indicator) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animation: Animation | undefined;
    let previous: { id: string; left: number; width: number } | undefined;
    const update = () => {
      const tab = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      const content =
        variant === "primary" ? tab?.querySelector<HTMLElement>("[data-tab-content]") : tab;
      if (!tab || !content) {
        animation?.cancel();
        indicator.style.setProperty("--tab-indicator-visibility", "hidden");
        previous = undefined;
        return;
      }
      const rect = content.getBoundingClientRect();
      const width = Math.max(variant === "primary" ? 24 : 0, rect.width);
      const left =
        rect.left - list.getBoundingClientRect().left + list.scrollLeft - (width - rect.width) / 2;
      if (previous?.id === tab.id && previous.left === left && previous.width === width) return;
      const current = getComputedStyle(indicator);
      const fromLeft = parseFloat(current.left);
      const fromWidth = parseFloat(current.width);
      animation?.cancel();
      indicator.style.setProperty("--tab-indicator-left", `${left}px`);
      indicator.style.setProperty("--tab-indicator-width", `${width}px`);
      indicator.style.setProperty("--tab-indicator-visibility", "visible");
      if (previous && previous.id !== tab.id && !reducedMotion.matches && indicator.animate) {
        const movingRight = fromLeft < left;
        // Android版のsine/cosine補間を17点で近似し、連続操作では現在位置から再開する。
        const frames = Array.from({ length: 17 }, (_, index) => {
          const progress = index / 16;
          const accelerate = 1 - Math.cos((progress * Math.PI) / 2);
          const decelerate = Math.sin((progress * Math.PI) / 2);
          const nextLeft = fromLeft + (left - fromLeft) * (movingRight ? accelerate : decelerate);
          const nextRight =
            fromLeft +
            fromWidth +
            (left + width - fromLeft - fromWidth) * (movingRight ? decelerate : accelerate);
          return { left: `${nextLeft}px`, width: `${nextRight - nextLeft}px`, offset: progress };
        });
        animation = indicator.animate(frames, { duration: 250, easing: "linear" });
      }
      previous = { id: tab.id, left, width };
    };
    update();
    const mutationObserver = new MutationObserver(update);
    mutationObserver.observe(list, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-selected"],
    });
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    resizeObserver?.observe(list);
    for (const content of list.querySelectorAll("[data-tab-content]"))
      resizeObserver?.observe(content);
    const stopMotion = () => {
      if (reducedMotion.matches) animation?.cancel();
    };
    reducedMotion.addEventListener("change", stopMotion);
    window.addEventListener("resize", update);
    return () => {
      animation?.cancel();
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      reducedMotion.removeEventListener("change", stopMotion);
      window.removeEventListener("resize", update);
    };
  }, [listRef, variant]);
}
