// A title is a complete topic label, never a clipped prompt excerpt.
export function conversationTitle(value) {
  if (typeof value !== "string") return null;
  const title = value.trim().replace(/\s+/g, " "),
    words = title.split(" ");
  if (
    Array.from(title).length > 60 ||
    words.length < 2 ||
    words.length > 8 ||
    /[\p{Cc}<>`\[\]{}]/u.test(title) ||
    /(?:\.{3}|…)$/.test(title) ||
    /^(?:new conversation|untitled|yes do it|general (?:chat|question)|help request)$/i.test(
      title,
    )
  )
    return null;
  return title || null;
}
