import { strFromU8, strToU8 } from "fflate";
export const WORD =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const SHEET =
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
export const XML = "http://www.w3.org/XML/1998/namespace";
export function xml(bytes) {
  const text = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("Documents with XML entities are not supported.");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length)
    throw new Error("The original document contains damaged XML.");
  return doc;
}
export const elements = (root, ns, name) =>
  Array.from(root.getElementsByTagNameNS(ns, name));
export const serialize = (doc) =>
  strToU8(new XMLSerializer().serializeToString(doc));
