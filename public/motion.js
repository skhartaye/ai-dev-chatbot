// Only newly created cards use this; existing list items never replay entrances.
export function reveal(node) {
  if (
    !node?.animate ||
    !globalThis.matchMedia ||
    matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.classList.contains("keyboard-navigation")
  )
    return;

  return node.animate(
    [
      { opacity: 0, transform: "translateY(8px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  );
}
