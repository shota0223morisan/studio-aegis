import { useEffect } from "react";

/**
 * Click a card's title to fold it (remembered per title, e.g. 「自分用メモ」 stays folded on every stage).
 * Works on every `.card` with a `.section-head` heading, without each card having to opt in.
 */
const KEY = "aegis.folded";

function load(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function save(set: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

const cardKey = (card: Element) => card.querySelector(":scope > .section-head h2")?.textContent?.trim() ?? "";

function apply(root: ParentNode, folded: Set<string>) {
  root.querySelectorAll?.(".card").forEach((card) => {
    const key = cardKey(card);
    if (key) card.classList.toggle("folded", folded.has(key));
  });
}

export function useFold() {
  useEffect(() => {
    let folded = load();
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const head = target.closest(".section-head");
      if (!head || !target.closest("h2, .sec-index, .sec-icon")) return;
      const card = head.parentElement;
      if (!card?.classList.contains("card")) return;
      const key = cardKey(card);
      if (!key) return;
      folded = load();
      if (folded.has(key)) folded.delete(key);
      else folded.add(key);
      save(folded);
      card.classList.toggle("folded", folded.has(key));
    };
    document.addEventListener("click", onClick);
    // Cards mount and re-mount as pages / stages change: keep their folded state.
    const obs = new MutationObserver((records) => {
      for (const r of records) r.addedNodes.forEach((n) => n instanceof Element && (n.classList.contains("card") ? apply(n.parentElement ?? n, folded) : apply(n, folded)));
    });
    obs.observe(document.body, { childList: true, subtree: true });
    apply(document, folded);
    return () => {
      document.removeEventListener("click", onClick);
      obs.disconnect();
    };
  }, []);
}
