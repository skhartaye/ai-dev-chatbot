// Reading position is local UI state; messages remain the source of truth.
export function createChatScroll(scroller, list, latest) {
  let conversation,
    following = true,
    anchor,
    previous = 0,
    restoring = false;
  const nearEnd = () =>
    scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 80;
  const capture = () => {
    const top = scroller.getBoundingClientRect().top;
    const item = Array.from(list.children).find(
      (n) => n.getBoundingClientRect().bottom > top + 1,
    );
    anchor = item
      ? {
          id: item.dataset.messageId,
          offset: item.getBoundingClientRect().top - top,
        }
      : null;
    previous = scroller.scrollTop;
  };
  const updateButton = () => {
    latest.hidden = nearEnd();
  };
  const restore = () => {
    restoring = true;
    if (following) scroller.scrollTop = scroller.scrollHeight;
    else {
      const item =
        anchor &&
        Array.from(list.children).find(
          (n) => n.dataset.messageId === anchor.id,
        );
      scroller.scrollTop = item
        ? scroller.scrollTop +
          item.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          anchor.offset
        : previous;
    }
    updateButton();
    restoring = false;
  };
  scroller.addEventListener(
    "scroll",
    () => {
      if (restoring) return;
      following = nearEnd();
      capture();
      updateButton();
    },
    { passive: true },
  );
  latest.addEventListener("click", () => {
    scroller.focus({ preventScroll: true });
    following = true;
    restore();
  });
  const observer =
    typeof ResizeObserver === "function" ? new ResizeObserver(restore) : null;
  observer?.observe(list);
  observer?.observe(scroller);
  return {
    beforeRender(id) {
      if (conversation !== id) {
        conversation = id;
        following = true;
        anchor = null;
      } else capture();
    },
    afterRender: restore,
    jumpToLatest() {
      following = true;
      restore();
    },
  };
}
