// Small JSON Schema toolkit for the business profile schema.
// - validate(): checks the subset of JSON Schema the profile schema uses.
// - sanitize(): repairs model output (enum casing, length and count limits,
//   missing fields, out-of-range numbers) and drops array entries it cannot fix.
// - toWireSchema(): turns the full schema into what Claude's structured outputs
//   accept (no length/number/count limits, every property required,
//   additionalProperties false), moving the limits into descriptions.

const typeOf = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
};
const matchesType = (t, v) => {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return t === actual;
};
const isObj = (v) => typeOf(v) === 'object';
const regexCache = new Map();
const rx = (p) => {
  if (!regexCache.has(p)) regexCache.set(p, new RegExp(p));
  return regexCache.get(p);
};
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Returns a list of { path, message }. Empty list means valid. */
export function validate(schema, value, path = '$') {
  const errors = [];
  check(schema, value, path, errors);
  return errors;
}

function check(s, v, p, errs) {
  if (s.type) {
    const types = [].concat(s.type);
    if (!types.some((t) => matchesType(t, v))) {
      errs.push({ path: p, message: `expected ${types.join('|')}, got ${typeOf(v)}` });
      return;
    }
  }
  if ('const' in s && v !== s.const) errs.push({ path: p, message: `must equal ${JSON.stringify(s.const)}` });
  if (s.enum && !s.enum.includes(v)) errs.push({ path: p, message: `must be one of ${s.enum.join(', ')}` });
  if (typeof v === 'string') {
    if (s.maxLength != null && v.length > s.maxLength) errs.push({ path: p, message: `longer than ${s.maxLength} characters` });
    if (s.minLength != null && v.length < s.minLength) errs.push({ path: p, message: `shorter than ${s.minLength} characters` });
    if (s.pattern && !rx(s.pattern).test(v)) errs.push({ path: p, message: `does not match ${s.pattern}` });
    if (s.format === 'date-time' && !(DATE_TIME.test(v) && !Number.isNaN(Date.parse(v)))) {
      errs.push({ path: p, message: 'not an ISO 8601 date-time' });
    }
  }
  if (typeof v === 'number') {
    if (s.minimum != null && v < s.minimum) errs.push({ path: p, message: `below minimum ${s.minimum}` });
    if (s.maximum != null && v > s.maximum) errs.push({ path: p, message: `above maximum ${s.maximum}` });
  }
  if (Array.isArray(v)) {
    if (s.maxItems != null && v.length > s.maxItems) errs.push({ path: p, message: `more than ${s.maxItems} items` });
    if (s.minItems != null && v.length < s.minItems) errs.push({ path: p, message: `fewer than ${s.minItems} items` });
    if (s.items) v.forEach((item, i) => check(s.items, item, `${p}[${i}]`, errs));
  }
  if (isObj(v)) {
    for (const key of s.required || []) {
      if (!(key in v)) errs.push({ path: `${p}.${key}`, message: 'is required' });
    }
    const props = s.properties || {};
    for (const [key, child] of Object.entries(v)) {
      if (props[key]) check(props[key], child, `${p}.${key}`, errs);
      else if (s.additionalProperties === false) errs.push({ path: `${p}.${key}`, message: 'is not allowed' });
    }
  }
}

const ENUM_FALLBACKS = ['unknown', 'none', 'other'];

/** A value that satisfies the schema with nothing known. */
export function defaultFor(s) {
  if ('const' in s) return s.const;
  if (s.enum) return ENUM_FALLBACKS.find((f) => s.enum.includes(f)) ?? s.enum[0];
  const t = [].concat(s.type || 'string')[0];
  if (t === 'string') return '';
  if (t === 'number' || t === 'integer') return s.minimum ?? 0;
  if (t === 'boolean') return false;
  if (t === 'array') return [];
  if (t === 'null') return null;
  if (t === 'object') {
    const out = {};
    for (const key of s.required || Object.keys(s.properties || {})) out[key] = defaultFor(s.properties[key]);
    return out;
  }
  return null;
}

/**
 * Repair a value against the schema. Returns { value, repairs } where repairs
 * lists what changed (for logging and tests).
 */
export function sanitize(schema, value) {
  const repairs = [];
  const out = fix(schema, value, '$', repairs);
  return { value: out, repairs };
}

function fix(s, v, p, repairs) {
  const t = [].concat(s.type || '')[0];

  if ('const' in s) {
    if (v !== s.const) repairs.push(`${p}: set to ${JSON.stringify(s.const)}`);
    return s.const;
  }

  if (t === 'string') {
    let str = v;
    if (typeof str !== 'string') {
      str = str == null ? '' : typeof str === 'object' ? '' : String(str);
      if (v != null) repairs.push(`${p}: converted to text`);
    }
    str = str.replace(/\u0000/g, '').trim();
    if (s.enum) {
      if (!s.enum.includes(str)) {
        const lower = str.toLowerCase().replace(/[\s-]+/g, '_');
        const match = s.enum.find((e) => String(e).toLowerCase() === lower);
        const fallback = match ?? defaultFor(s);
        repairs.push(`${p}: "${str}" -> "${fallback}"`);
        str = fallback;
      }
      return str;
    }
    if (s.pattern === '^#[0-9A-Fa-f]{6}$' && /^#[0-9a-f]{3}$/i.test(str)) {
      str = '#' + str.slice(1).split('').map((c) => c + c).join('');
      repairs.push(`${p}: expanded short hex color`);
    }
    if (s.pattern && !rx(s.pattern).test(str) && rx(s.pattern).test('')) {
      repairs.push(`${p}: "${str}" cleared (bad format)`);
      str = '';
    }
    if (s.maxLength != null && str.length > s.maxLength) {
      repairs.push(`${p}: trimmed to ${s.maxLength} characters`);
      str = truncate(str, s.maxLength);
    }
    return str;
  }

  if (t === 'number' || t === 'integer') {
    let n = typeof v === 'number' ? v : Number.parseFloat(v);
    if (!Number.isFinite(n)) {
      if (v != null) repairs.push(`${p}: not a number, set to default`);
      n = defaultFor(s);
    } else if (typeof v !== 'number') repairs.push(`${p}: converted to a number`);
    if (t === 'integer' && !Number.isInteger(n)) { repairs.push(`${p}: rounded to a whole number`); n = Math.round(n); }
    if (s.minimum != null && n < s.minimum) { repairs.push(`${p}: raised to ${s.minimum}`); n = s.minimum; }
    if (s.maximum != null && n > s.maximum) { repairs.push(`${p}: lowered to ${s.maximum}`); n = s.maximum; }
    return n;
  }

  if (t === 'boolean') {
    if (typeof v === 'boolean') return v;
    if (v === 'true') return true;
    if (v != null && v !== 'false') repairs.push(`${p}: not a boolean, set to false`);
    return false;
  }

  if (t === 'array') {
    let arr = Array.isArray(v) ? v : [];
    if (!Array.isArray(v) && v != null) repairs.push(`${p}: not a list, emptied`);
    const kept = [];
    arr.forEach((item, i) => {
      const fixed = s.items ? fix(s.items, item, `${p}[${i}]`, repairs) : item;
      if (s.items && validate(s.items, fixed).length) {
        repairs.push(`${p}[${i}]: dropped (could not repair)`);
        return;
      }
      if (s.items && typeOf(fixed) === 'string' && fixed === '' ) return; // drop blank strings in lists
      kept.push(fixed);
    });
    if (s.maxItems != null && kept.length > s.maxItems) {
      repairs.push(`${p}: cut to ${s.maxItems} items`);
      kept.length = s.maxItems;
    }
    return kept;
  }

  if (t === 'object') {
    const src = isObj(v) ? v : {};
    if (!isObj(v) && v != null) repairs.push(`${p}: not an object, rebuilt`);
    const out = {};
    const props = s.properties || {};
    for (const [key, child] of Object.entries(props)) {
      if (key in src) out[key] = fix(child, src[key], `${p}.${key}`, repairs);
      else if ((s.required || []).includes(key)) {
        repairs.push(`${p}.${key}: missing, filled with default`);
        out[key] = defaultFor(child);
      }
    }
    if (s.additionalProperties !== false) {
      for (const key of Object.keys(src)) if (!(key in props)) out[key] = src[key];
    } else {
      for (const key of Object.keys(src)) if (!(key in props)) repairs.push(`${p}.${key}: removed (unknown field)`);
    }
    return out;
  }

  return v;
}

function truncate(str, max) {
  if (str.length <= max) return str;
  const cut = str.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '') + '…';
}

// ---------------------------------------------------------------------------
// Wire schema for Claude structured outputs
// ---------------------------------------------------------------------------

const UNSUPPORTED = new Set([
  'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'multipleOf', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties',
]);
const SUPPORTED_FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid']);
const HINT = {
  maxLength: (v) => `At most ${v} characters.`,
  minLength: (v) => `At least ${v} characters.`,
  maximum: (v) => `Maximum ${v}.`,
  minimum: (v) => `Minimum ${v}.`,
  maxItems: (v) => `At most ${v} items.`,
  minItems: (v) => `At least ${v} items.`,
};

/**
 * @param {object} schema full schema
 * @param {{ omit?: string[] }} opts top-level properties filled by code, not the model
 */
export function toWireSchema(schema, { omit = [] } = {}) {
  const wire = toWire(schema, true);
  for (const key of omit) delete wire.properties[key];
  wire.required = Object.keys(wire.properties);
  return wire;
}

function toWire(s, top) {
  const out = {};
  const hints = [];
  for (const [k, v] of Object.entries(s)) {
    if (top && (k === '$schema' || k === '$id' || k === 'title')) continue;
    if (UNSUPPORTED.has(k)) { if (HINT[k]) hints.push(HINT[k](v)); continue; }
    if (k === 'minItems' && v > 1) { hints.push(HINT.minItems(v)); continue; }
    if (k === 'format' && !SUPPORTED_FORMATS.has(v)) continue;
    if (k === 'properties') {
      out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toWire(pv, false)]));
    } else if (k === 'items') {
      out.items = toWire(v, false);
    } else if (k === 'anyOf' || k === 'allOf') {
      out[k] = v.map((c) => toWire(c, false));
    } else {
      out[k] = structuredClone(v);
    }
  }
  if ([].concat(out.type || '').includes('object')) {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties || {});
  }
  if (hints.length) out.description = [out.description, hints.join(' ')].filter(Boolean).join(' ');
  return out;
}

/** Counts the things the structured-outputs complexity limits care about. */
export function schemaStats(s) {
  const stats = { objects: 0, properties: 0, optional: 0, unions: 0, enums: 0, unsupported: [] };
  (function walk(n, p) {
    if (!isObj(n)) return;
    if (Array.isArray(n.type) || n.anyOf) stats.unions++;
    if (n.enum) stats.enums++;
    for (const k of Object.keys(n)) if (UNSUPPORTED.has(k)) stats.unsupported.push(`${p}.${k}`);
    if (n.properties) {
      stats.objects++;
      const req = new Set(n.required || []);
      for (const [k, v] of Object.entries(n.properties)) {
        stats.properties++;
        if (!req.has(k)) stats.optional++;
        walk(v, `${p}.${k}`);
      }
      if (n.additionalProperties !== false) stats.unsupported.push(`${p}: additionalProperties not false`);
    }
    if (n.items) walk(n.items, `${p}[]`);
  })(s, '$');
  return stats;
}

/** Read a dotted path such as "contact.address.city" or "hours.weekly[0].open". */
export function getPath(obj, path) {
  return splitPath(path).reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** Write a dotted path, creating objects/arrays as needed. Returns obj. */
export function setPath(obj, path, value) {
  const keys = splitPath(path);
  let o = obj;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) { o[k] = value; return; }
    if (o[k] == null || typeof o[k] !== 'object') o[k] = typeof keys[i + 1] === 'number' ? [] : {};
    o = o[k];
  });
  return obj;
}

function splitPath(path) {
  return String(path)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .map((k) => (/^\d+$/.test(k) ? Number(k) : k));
}
