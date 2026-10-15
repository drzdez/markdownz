// Excel number formats ("#,##0 [$€-x]", "0.00%", "d.m.yyyy", "[Red]-0", …): the text a
// cell shows for its value. Separators, month and day names follow the locale, as
// Excel takes them from the system.

/** Formats Excel builds in; 14 and 22 are the locale's short date (and time). */
const BUILT_IN: Record<number, string> = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mm:ss.0",
  48: "##0.0E+0",
  49: "@",
};

export const SHORT_DATE = "\u0000date";
export const SHORT_DATE_TIME = "\u0000datetime";

/** The code of a built-in format id; General when unknown. */
export function builtInFormat(id: number): string {
  if (id === 14) return SHORT_DATE;
  if (id === 22) return SHORT_DATE_TIME;
  if (id >= 27 && id <= 36) return SHORT_DATE; // East Asian dates
  if (id >= 50 && id <= 58) return SHORT_DATE;
  return BUILT_IN[id] ?? "General";
}

export interface Formatted {
  text: string;
  /** Where a fill ("* ", accounting formats) pushes the rest of the text to the right edge of the cell. */
  fill?: number;
  /** CSS colour of a [Red]-style section. */
  color?: string;
}

const COLORS: Record<string, string> = {
  black: "#000000",
  blue: "#0000ff",
  cyan: "#00ffff",
  green: "#00ff00",
  magenta: "#ff00ff",
  red: "#ff0000",
  white: "#ffffff",
  yellow: "#ffff00",
};

interface Locale {
  /** BCP 47 tag for month and day names; none = the system's. */
  tag?: string;
  decimal: string;
  group: string;
  /** What "/" in a date format shows: the system's date separator. */
  dateSep: string;
}

let cachedLocale: Locale | undefined;

function systemLocale(): Locale {
  if (!cachedLocale) {
    const parts = new Intl.NumberFormat(undefined, { useGrouping: true }).formatToParts(1234567.5);
    const dateParts = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(2000, 10, 22));
    cachedLocale = {
      decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
      group: parts.find((p) => p.type === "group")?.value ?? ",",
      dateSep: dateParts.find((p) => p.type === "literal")?.value.trim() || "/",
    };
  }
  return cachedLocale;
}

/** Sections of a format code, split at ";" outside quotes, escapes and brackets. */
function sections(code: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') {
      const end = code.indexOf('"', i + 1);
      const stop = end < 0 ? code.length : end;
      cur += code.slice(i, stop + 1);
      i = stop;
    } else if (ch === "\\" || ch === "_" || ch === "*") {
      cur += code.slice(i, i + 2);
      i++;
    } else if (ch === "[") {
      const end = code.indexOf("]", i);
      const stop = end < 0 ? code.length : end;
      cur += code.slice(i, stop + 1);
      i = stop;
    } else if (ch === ";") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

type Token =
  | { kind: "lit"; text: string }
  | { kind: "code"; text: string } // number placeholders and date parts, unquoted
  | { kind: "text" } // @
  | { kind: "fill" }; // *x: repeat x to fill the cell

/** Marks the fill position in formatted text until it is split off. */
const FILL = "";

interface Section {
  tokens: Token[];
  /** The code without literals, e.g. for fractions ("# ?/?"). */
  bare: string;
  color?: string;
  condition?: (v: number) => boolean;
  elapsed: boolean;
}

function parseSection(src: string): Section {
  const tokens: Token[] = [];
  let color: string | undefined;
  let condition: ((v: number) => boolean) | undefined;
  const lit = (text: string) => {
    const last = tokens[tokens.length - 1];
    if (last?.kind === "lit") last.text += text;
    else tokens.push({ kind: "lit", text });
  };
  const code = (text: string) => {
    const last = tokens[tokens.length - 1];
    if (last?.kind === "code") last.text += text;
    else tokens.push({ kind: "code", text });
  };
  let elapsed = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      const stop = end < 0 ? src.length : end;
      lit(src.slice(i + 1, stop));
      i = stop;
    } else if (ch === "\\") {
      lit(src[i + 1] ?? "");
      i++;
    } else if (ch === "_") {
      lit(" ");
      i++;
    } else if (ch === "*") {
      tokens.push({ kind: "fill" });
      i++;
    } else if (ch === "[") {
      const end = src.indexOf("]", i);
      const inner = src.slice(i + 1, end < 0 ? src.length : end);
      i = end < 0 ? src.length : end;
      const lower = inner.toLowerCase();
      if (COLORS[lower]) color = COLORS[lower];
      else if (/^color\s*\d+$/.test(lower)) color = undefined;
      else if (inner.startsWith("$")) {
        const symbol = inner.slice(1).split("-")[0];
        if (symbol) lit(symbol);
      } else if (/^[<>=]/.test(inner)) {
        const m = /^(<=|>=|<>|<|>|=)\s*(-?[\d.]+)$/.exec(inner);
        if (m) {
          const n = parseFloat(m[2]);
          const ops: Record<string, (v: number) => boolean> = {
            "<": (v) => v < n,
            ">": (v) => v > n,
            "=": (v) => v === n,
            "<=": (v) => v <= n,
            ">=": (v) => v >= n,
            "<>": (v) => v !== n,
          };
          condition = ops[m[1]];
        }
      } else if (/^(h+|m+|s+)$/i.test(inner)) {
        elapsed = true;
        code(`[${inner.toLowerCase()}]`);
      }
    } else if (ch === "@") tokens.push({ kind: "text" });
    else if ("0#?.,%Ee+-/:yYmMdDhHsSaApP".includes(ch)) {
      if ((ch === "E" || ch === "e") && (src[i + 1] === "+" || src[i + 1] === "-")) {
        code(src.slice(i, i + 2));
        i++;
      } else if ((ch === "A" || ch === "a") && /^am\/pm/i.test(src.slice(i))) {
        code(src.slice(i, i + 5));
        i += 4;
      } else if ((ch === "A" || ch === "a") && /^a\/p/i.test(src.slice(i))) {
        code(src.slice(i, i + 3));
        i += 2;
      } else if (ch === "/" && /[0#?]\s*$/.test(src.slice(0, i)) && /^\s*[0#?\d]/.test(src.slice(i + 1))) {
        // A fraction; a fixed denominator ("?/8") belongs to it.
        let j = i + 1;
        while (/\d/.test(src[j] ?? "")) j++;
        code(src.slice(i, j));
        i = j - 1;
      } else if (ch === "/") {
        code(ch); // a date separator
      } else if ("+-:".includes(ch) || ch === "a" || ch === "A" || ch === "p" || ch === "P") lit(ch);
      else code(ch);
    } else lit(ch);
  }
  const bare = src.replace(/"[^"]*"|\[[^\]]*\]|\\.|_.|\*./g, "");
  return { tokens, color, condition, elapsed, bare };
}

const isDateCode = (s: Section) => s.tokens.some((t) => t.kind === "code" && /[ymdhs]/i.test(t.text) && !/[0#?]/.test(t.text.replace(/\.0+/, "")));

function pickSection(all: Section[], value: number): { section: Section; abs: boolean } {
  const conditional = all.filter((s) => s.condition);
  if (conditional.length) {
    for (const s of all.slice(0, 2)) if (s.condition?.(value)) return { section: s, abs: true };
    const rest = all.find((s, i) => i >= conditional.length && !s.condition && !s.tokens.some((t) => t.kind === "text"));
    return { section: rest ?? all[all.length - 1], abs: false };
  }
  const numeric = all.filter((s, i) => i < 3 && !(i > 0 && s.tokens.length === 1 && s.tokens[0].kind === "text"));
  if (numeric.length >= 3 && value === 0) return { section: numeric[2], abs: false };
  if (numeric.length >= 2 && value < 0) return { section: numeric[1], abs: true };
  return { section: numeric[0] ?? all[0], abs: false };
}

/** Excel's "General": up to 11 characters, exponential for very large and small numbers. */
export function general(value: number, locale = systemLocale()): string {
  if (!isFinite(value)) return "#NUM!";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  let text: string;
  if (abs >= 1e11 || abs < 1e-9) {
    const [m, e] = value.toExponential(5).split("e");
    const mantissa = m.replace(/\.?0+$/, "");
    const exp = parseInt(e, 10);
    text = `${mantissa}E${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  } else {
    const intDigits = abs >= 1 ? Math.floor(Math.log10(abs)) + 1 : 1;
    text = value.toFixed(Math.max(0, 10 - intDigits));
    if (text.includes(".")) text = text.replace(/\.?0+$/, "");
  }
  return text.replace(".", locale.decimal);
}

function formatDigits(value: number, pattern: string, locale: Locale): string {
  // Scientific: mantissa and exponent.
  const e = /[Ee][+-]/.exec(pattern);
  if (e) {
    const mantPat = pattern.slice(0, e.index);
    const expPat = pattern.slice(e.index + 2);
    const intDigits = (mantPat.split(".")[0].match(/[0#?]/g) ?? []).length || 1;
    let exp = value === 0 ? 0 : Math.floor(Math.log10(Math.abs(value)));
    // Engineering style "##0.0E+0": exponent multiple of the integer digits.
    if (intDigits > 1 && /#/.test(mantPat.split(".")[0])) exp = Math.floor(exp / intDigits) * intDigits;
    const mant = value / Math.pow(10, exp);
    const sign = exp < 0 ? "-" : e[0][1] === "+" ? "+" : "";
    const expText = String(Math.abs(exp)).padStart((expPat.match(/0/g) ?? []).length, "0");
    return `${formatDigits(mant, mantPat, locale)}E${sign}${expText}`;
  }
  const dot = pattern.indexOf(".");
  const intPat = dot < 0 ? pattern : pattern.slice(0, dot);
  const fracPat = dot < 0 ? "" : pattern.slice(dot + 1);
  const grouping = /[0#?],+[0#?]/.test(intPat);
  const minInt = (intPat.match(/0/g) ?? []).length;
  const padInt = (intPat.match(/\?/g) ?? []).length;
  const fracMin = (fracPat.match(/0/g) ?? []).length;
  const fracSpaces = (fracPat.match(/\?/g) ?? []).length;
  const fracMax = fracMin + fracSpaces + (fracPat.match(/#/g) ?? []).length;

  const fixed = Math.abs(value).toFixed(fracMax);
  let [int, frac = ""] = fixed.split(".");
  if (int === "0" && minInt === 0) int = "";
  int = int.padStart(minInt, "0");
  if (grouping) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, locale.group);
  if (padInt > minInt && int.length < padInt) int = int.padStart(padInt, " ");
  // Trailing zeros beyond the "0" placeholders go; "?" turns them into spaces.
  let trimmed = frac;
  while (trimmed.length > fracMin && trimmed.endsWith("0")) trimmed = trimmed.slice(0, -1);
  const spaces = Math.min(frac.length - trimmed.length, fracSpaces);
  frac = trimmed + " ".repeat(spaces);
  return dot < 0 ? int : `${int}${locale.decimal}${frac}`;
}

function formatNumberSection(value: number, section: Section, locale: Locale): string {
  let v = value;
  const codeText = section.tokens.filter((t) => t.kind === "code").map((t) => t.text).join("");
  const percents = (codeText.match(/%/g) ?? []).length;
  v *= Math.pow(100, percents);
  // Commas right after the last digit placeholder divide by thousands.
  const scale = /[0#?](,+)(?![0#?])/.exec(codeText.replace(/%/g, ""));
  if (scale) v /= Math.pow(1000, scale[1].length);
  const fraction = /[#0?]\s*\/\s*[#0?\d]/.test(section.bare);
  let out = "";
  let numberDone = false;
  // Literals inside the number ("# ?/?") are part of the digits written in one go.
  const first = section.tokens.findIndex((t) => t.kind === "code");
  const last = section.tokens.map((t) => t.kind).lastIndexOf("code");
  const masked = !fraction && !/[.Ee]/.test(codeText) && section.tokens.slice(first, last).some((t) => t.kind === "lit");
  for (const [i, t] of section.tokens.entries()) {
    if (t.kind === "lit" && i > first && i < last) continue;
    if (t.kind === "lit") out += t.text;
    else if (t.kind === "fill") out += FILL;
    else if (t.kind === "text") out += general(value, locale);
    else if (!numberDone) {
      numberDone = true;
      if (fraction) {
        out += formatFraction(v, section.bare, locale);
      } else if (masked) {
        out += maskDigits(v, section.tokens.slice(first, last + 1));
      } else {
        const pattern = codeText.replace(/%/g, "").replace(/,+(?![0#?])/g, "");
        const digits = formatDigits(v, pattern, locale);
        // The literal "%" signs stay where the code has them.
        out += digits + "%".repeat(percents);
      }
    }
  }
  return out;
}

/** Digits written into a mask with literals between the placeholders, e.g. "000-000". */
function maskDigits(v: number, tokens: Token[]): string {
  let digits = String(Math.round(Math.abs(v)));
  if (digits === "0") digits = "";
  let out = "";
  for (const t of [...tokens].reverse()) {
    if (t.kind === "lit") out = t.text + out;
    else if (t.kind === "code") {
      for (const ch of [...t.text].reverse()) {
        if (!"0#?".includes(ch)) continue;
        const d = digits.slice(-1);
        digits = digits.slice(0, -1);
        out = (d || (ch === "0" ? "0" : ch === "?" ? " " : "")) + out;
      }
    }
  }
  return digits + out;
}

function formatFraction(v: number, code: string, locale: Locale): string {
  const m = /^(?:([#0?]+)\s+)?([#0?]+)\s*\/\s*([#0?]+|\d+)/.exec(code.trim());
  if (!m) return general(v, locale);
  const whole = m[1] !== undefined;
  const abs = Math.abs(v);
  const int = whole ? Math.floor(abs) : 0;
  const rest = abs - int;
  let num: number;
  let den: number;
  if (/^\d+$/.test(m[3])) {
    den = parseInt(m[3], 10);
    num = Math.round(rest * den);
  } else {
    const maxDen = Math.pow(10, m[3].length) - 1;
    [num, den] = [0, 1];
    let best = Infinity;
    for (let d = 1; d <= maxDen; d++) {
      const n = Math.round(rest * d);
      const err = Math.abs(rest - n / d);
      if (err < best - 1e-12) [best, num, den] = [err, n, d];
    }
  }
  // "?" placeholders keep their width with spaces, so fractions line up in a column.
  const numWidth = m[2].includes("?") ? m[2].length : 0;
  const denWidth = m[3].includes("?") ? m[3].length : 0;
  if (whole && (num === 0 || num === den)) return String(num ? int + 1 : int) + " ".repeat(2 + Math.max(numWidth, 1) + Math.max(denWidth, 1));
  const intText = whole ? `${int || ""} ` : "";
  return `${intText}${String(num).padStart(numWidth, " ")}/${String(den).padEnd(denWidth, " ")}`;
}

const DAY = 86400000;

/** The date of an Excel serial number (days since 1900, with Excel's 29 February 1900; or since 1904). */
export function serialToDate(serial: number, date1904 = false): Date {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : serial < 61 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.round(serial * DAY));
}

function formatDateSection(value: number, section: Section, date1904: boolean, locale: Locale): string {
  // Without fractions of a second, Excel rounds to whole seconds.
  if (!section.tokens.some((t) => t.kind === "code" && /s\.0/i.test(t.text))) value = Math.round(value * 86400) / 86400;
  const date = serialToDate(value, date1904);
  // Excel's day 0 is "0 January 1900".
  const zero = !date1904 && value < 1;
  const y = zero ? 1900 : date.getUTCFullYear();
  const mo = zero ? 0 : date.getUTCMonth();
  const d = zero ? 0 : date.getUTCDate();
  const totalSeconds = Math.round(value * 86400);
  const hourOfDay = date.getUTCHours();
  const min = date.getUTCMinutes();
  const sec = date.getUTCSeconds();
  const codes = section.tokens.filter((t) => t.kind === "code").map((t) => t.text).join(" ");
  const ampm = /am\/pm|a\/p/i.test(codes);
  // Excel counts 1900 as a leap year, so its weekdays before March 1900 are one day off.
  const weekday = date1904 || value >= 61 ? date.getUTCDay() : (Math.floor(value) + 6) % 7;
  const name = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale.tag, { ...opts, timeZone: "UTC" }).format(opts.weekday ? new Date(Date.UTC(2023, 0, 1 + weekday)) : new Date(Date.UTC(2023, mo, 15)));
  const period = (pm: boolean) =>
    new Intl.DateTimeFormat(locale.tag, { hour: "numeric", hour12: true, timeZone: "UTC" }).formatToParts(new Date(Date.UTC(2023, 0, 1, pm ? 15 : 3))).find((p) => p.type === "dayPeriod")?.value ??
    (pm ? "PM" : "AM");

  // Split every code token into its parts: yyyy, m, d, h, s, .0, AM/PM, [h].
  const parts: { kind: "lit" | "part"; text: string }[] = [];
  for (const t of section.tokens) {
    if (t.kind !== "code") {
      parts.push({ kind: "lit", text: t.kind === "lit" ? t.text : "" });
      continue;
    }
    const re = /\[[hms]+\]|am\/pm|a\/p|y+|m+|d+|h+|s+|\.0+|./gi;
    for (const m of t.text.match(re) ?? []) parts.push({ kind: "part", text: m });
  }
  // "m" next to hours or seconds means minutes.
  const isMinute = (i: number) => {
    for (let j = i - 1; j >= 0; j--) {
      const p = parts[j];
      if (p.kind === "part" && /^[ydhs[]/i.test(p.text)) return /^(h|\[h)/i.test(p.text);
    }
    for (let j = i + 1; j < parts.length; j++) {
      const p = parts[j];
      if (p.kind === "part" && /^[ydhs[]/i.test(p.text)) return /^s|^\[s/i.test(p.text);
    }
    return false;
  };
  let out = "";
  parts.forEach((p, i) => {
    if (p.kind === "lit") {
      out += p.text;
      return;
    }
    const t = p.text.toLowerCase();
    if (t.startsWith("[h")) out += String(Math.floor(totalSeconds / 3600)).padStart(t.length - 2, "0");
    else if (t.startsWith("[m")) out += String(Math.floor(totalSeconds / 60)).padStart(t.length - 2, "0");
    else if (t.startsWith("[s")) out += String(totalSeconds).padStart(t.length - 2, "0");
    else if (t[0] === "y") out += t.length <= 2 ? String(y % 100).padStart(2, "0") : String(y);
    else if (t[0] === "m" && t.length <= 2 && isMinute(i)) out += String(min).padStart(t.length, "0");
    else if (t[0] === "m") {
      if (t.length === 1) out += String(mo + 1);
      else if (t.length === 2) out += String(mo + 1).padStart(2, "0");
      else if (t.length === 3) out += name({ month: "short" });
      else if (t.length === 5) out += name({ month: "short" }).charAt(0);
      else out += name({ month: "long" });
    } else if (t[0] === "d") {
      if (t.length === 1) out += String(d);
      else if (t.length === 2) out += String(d).padStart(2, "0");
      else if (t.length === 3) out += name({ weekday: "short" });
      else out += name({ weekday: "long" });
    } else if (t[0] === "h") {
      const h = ampm ? hourOfDay % 12 || 12 : hourOfDay;
      out += String(h).padStart(t.length >= 2 ? 2 : 1, "0");
    } else if (t[0] === "s") out += String(sec).padStart(t.length >= 2 ? 2 : 1, "0");
    else if (t.startsWith(".0")) {
      const fraction = value * 86400 - Math.floor(value * 86400);
      out += (fraction.toFixed(t.length - 1).slice(1) || "").replace(".", locale.decimal);
    } else if (t === "am/pm") out += period(hourOfDay >= 12);
    else if (t === "a/p") out += hourOfDay < 12 ? "A" : "P";
    else if (t === "/") out += locale.dateSep;
    else out += p.text;
  });
  return out;
}

/** The system's short date (15.10.2026, 10/15/2026), as Windows writes it: no spaces after the separators. */
function shortDate(value: number, date1904: boolean, time: boolean, locale: Locale): string {
  const date = serialToDate(value, date1904);
  const parts = new Intl.DateTimeFormat(locale.tag, { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" }).formatToParts(date);
  const text = parts.map((p) => (p.type === "literal" ? p.value.trim() : p.value)).join("");
  return time ? `${text} ${date.getUTCHours()}:${String(date.getUTCMinutes()).padStart(2, "0")}` : text;
}

/** The text Excel shows for `value` with the format `code`. */
export function formatNumber(value: number, code: string, date1904 = false): Formatted {
  const locale = systemLocale();
  if (code === SHORT_DATE || code === SHORT_DATE_TIME) return { text: shortDate(value, date1904, code === SHORT_DATE_TIME, locale) };
  if (!code || /^general$/i.test(code.trim())) return { text: general(value, locale) };
  const all = sections(code).map(parseSection);
  const { section, abs } = pickSection(all, value);
  const v = abs ? Math.abs(value) : value;
  const hasCode = section.tokens.some((t) => t.kind === "code");
  let text: string;
  if (isDateCode(section)) {
    // Before 1900 or after 9999 there is no date: Excel fills the cell with "#".
    if (value < 0 || value >= 2958466) return { text: "#".repeat(8) };
    text = formatDateSection(v, section, date1904, locale);
  } else if (!hasCode) {
    // Only literals, e.g. "General" variants or "-": General with them around it.
    const generalWord = section.tokens.some((t) => t.kind === "lit" && /general/i.test(t.text));
    text = section.tokens
      .map((t) => (t.kind === "lit" ? (generalWord ? t.text.replace(/general/i, general(v, locale)) : t.text) : t.kind === "fill" ? FILL : general(v, locale)))
      .join("");
  } else {
    text = formatNumberSection(v, section, locale);
    // One section only: the minus sign comes from the value.
    if (value < 0 && !abs && all.length === 1 && /[1-9]/.test(text)) text = `-${text}`;
  }
  const out: Formatted = { text };
  const fill = text.indexOf(FILL);
  if (fill >= 0) {
    out.text = text.replaceAll(FILL, "");
    out.fill = fill;
  }
  if (section.color) out.color = section.color;
  return out;
}

/** The text of a string cell with a format whose text section has literals ("Name: @"). */
export function formatText(text: string, code: string): string {
  if (!code || !code.includes("@")) return text;
  const all = sections(code).map(parseSection);
  const section = all.find((s) => s.tokens.some((t) => t.kind === "text"));
  if (!section) return text;
  return section.tokens.map((t) => (t.kind === "text" ? text : t.kind === "lit" ? t.text : "")).join("");
}

/** For tests: use these separators instead of the system's. */
export function setLocaleForTests(decimal: string, group: string, tag?: string, dateSep = "/"): void {
  cachedLocale = { decimal, group, tag, dateSep };
}
