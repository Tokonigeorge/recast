/** Minimal ARIA 1.2 schema for static validation. Covers the common roles/attrs. */

export const VALID_ARIA_ATTRS = new Set([
  "aria-activedescendant", "aria-atomic", "aria-autocomplete", "aria-braillelabel",
  "aria-brailleroledescription", "aria-busy", "aria-checked", "aria-colcount",
  "aria-colindex", "aria-colindextext", "aria-colspan", "aria-controls",
  "aria-current", "aria-describedby", "aria-description", "aria-details",
  "aria-disabled", "aria-dropeffect", "aria-errormessage", "aria-expanded",
  "aria-flowto", "aria-grabbed", "aria-haspopup", "aria-hidden", "aria-invalid",
  "aria-keyshortcuts", "aria-label", "aria-labelledby", "aria-level", "aria-live",
  "aria-modal", "aria-multiline", "aria-multiselectable", "aria-orientation",
  "aria-owns", "aria-placeholder", "aria-posinset", "aria-pressed", "aria-readonly",
  "aria-relevant", "aria-required", "aria-roledescription", "aria-rowcount",
  "aria-rowindex", "aria-rowindextext", "aria-rowspan", "aria-selected", "aria-setsize",
  "aria-sort", "aria-valuemax", "aria-valuemin", "aria-valuenow", "aria-valuetext",
]);

export const VALID_ROLES = new Set([
  "alert", "alertdialog", "application", "article", "banner", "blockquote",
  "button", "caption", "cell", "checkbox", "code", "columnheader", "combobox",
  "complementary", "contentinfo", "definition", "deletion", "dialog", "directory",
  "document", "emphasis", "feed", "figure", "form", "generic", "grid", "gridcell",
  "group", "heading", "img", "insertion", "link", "list", "listbox", "listitem",
  "log", "main", "mark", "marquee", "math", "menu", "menubar", "menuitem",
  "menuitemcheckbox", "menuitemradio", "meter", "navigation", "none", "note",
  "option", "paragraph", "presentation", "progressbar", "radio", "radiogroup",
  "region", "row", "rowgroup", "rowheader", "scrollbar", "search", "searchbox",
  "separator", "slider", "spinbutton", "status", "strong", "subscript", "superscript",
  "suggestion", "switch", "tab", "table", "tablist", "tabpanel", "term", "textbox",
  "time", "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem",
]);

/** Enumerated valid values for specific aria attributes. */
export const ARIA_ENUM_VALUES: Record<string, Set<string>> = {
  "aria-autocomplete": new Set(["none", "inline", "list", "both"]),
  "aria-checked": new Set(["true", "false", "mixed", "undefined"]),
  "aria-current": new Set(["true", "false", "page", "step", "location", "date", "time"]),
  "aria-dropeffect": new Set(["copy", "execute", "link", "move", "none", "popup"]),
  "aria-expanded": new Set(["true", "false", "undefined"]),
  "aria-haspopup": new Set(["true", "false", "menu", "listbox", "tree", "grid", "dialog"]),
  "aria-hidden": new Set(["true", "false", "undefined"]),
  "aria-invalid": new Set(["true", "false", "grammar", "spelling"]),
  "aria-live": new Set(["off", "polite", "assertive"]),
  "aria-orientation": new Set(["horizontal", "vertical", "undefined"]),
  "aria-pressed": new Set(["true", "false", "mixed", "undefined"]),
  "aria-relevant": new Set(["additions", "removals", "text", "all"]),
  "aria-sort": new Set(["ascending", "descending", "none", "other"]),
};

/** Required attributes per role. */
export const ROLE_REQUIRED_ATTRS: Record<string, string[]> = {
  checkbox: ["aria-checked"],
  combobox: ["aria-expanded"],
  heading: ["aria-level"],
  meter: ["aria-valuenow"],
  option: ["aria-selected"],
  progressbar: [],
  radio: ["aria-checked"],
  scrollbar: ["aria-controls", "aria-valuenow"],
  separator: [],
  slider: ["aria-valuenow"],
  spinbutton: [],
  switch: ["aria-checked"],
  tab: [],
  tabpanel: [],
  textbox: [],
  treeitem: [],
};

/** Common BCP 47 primary language subtags (a non-exhaustive list for sanity check). */
export const VALID_LANG_PRIMARY = new Set([
  "ar", "bg", "bn", "cs", "da", "de", "el", "en", "es", "et", "fa", "fi", "fr",
  "he", "hi", "hr", "hu", "id", "it", "ja", "ko", "lt", "lv", "ms", "nb", "nl",
  "no", "pl", "pt", "ro", "ru", "sk", "sl", "sr", "sv", "th", "tr", "uk", "ur",
  "vi", "zh",
]);

export function isValidLang(lang: string): boolean {
  const primary = lang.split("-")[0].toLowerCase();
  return VALID_LANG_PRIMARY.has(primary) || /^[a-z]{2,3}$/.test(primary);
}
