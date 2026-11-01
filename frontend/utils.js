export function utf16(text, offset) {
  return Array.from(text).slice(0, offset).join("").length;
}
