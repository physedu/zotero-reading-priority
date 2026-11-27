/* Reading Priority for Zotero — reads existing tags only. No network or writes. */
var registeredKeys = [];
const IMPORTANCE = ['essential', 'important', 'optional'];
const URGENCY = ['read-first', 'read-later'];
const NO_VALUE = '99|';
const NO_ORDER = '9999999999999999|';

function classify(item) {
  if (!item || typeof item.isRegularItem !== 'function' || !item.isRegularItem()) return null;
  const tags = new Set(item.getTags().map(t => t.tag));
  const importance = IMPORTANCE.findIndex(t => tags.has(t));
  const urgency = URGENCY.findIndex(t => tags.has(t));
  let order = null;
  let orderTag = null;
  for (const tag of tags) {
    const match = /^reading-order:\s*(\d+)$/.exec(tag);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isSafeInteger(value) && value > 0 && (order === null || value < order)) {
      order = value;
      orderTag = tag;
    }
  }
  return { importance, urgency, order, orderTag };
}

// A sortable prefix is separated from the visible text. Fixed-width numeric
// prefixes ensure correct ordering even with a non-numeric text comparator.
function columnValue(item, field) {
  const c = classify(item);
  if (!c) return field === 'order' ? NO_ORDER : NO_VALUE;
  // Put the library and tag in the sortable string so rendering does not
  // depend on the callback's `this` binding or the currently selected item.
  const meta = (prefix, label, tag) => `${prefix}|${label}|${item.libraryID}|${tag}`;
  if (field === 'order') {
    return c.order !== null
      ? meta(String(c.order).padStart(16, '0'), c.order, c.orderTag) : NO_ORDER;
  }
  if (field === 'importance') return c.importance < 0 ? NO_VALUE : meta(`0${c.importance + 1}`, IMPORTANCE[c.importance], IMPORTANCE[c.importance]);
  if (field === 'urgency') return c.urgency < 0 ? NO_VALUE : meta(`0${c.urgency + 1}`, URGENCY[c.urgency], URGENCY[c.urgency]);
  if (field === 'priority') {
    if (c.importance < 0 || c.urgency < 0) return NO_VALUE;
    const rank = c.urgency * IMPORTANCE.length + c.importance + 1;
    return `0${rank}|${rank}`;
  }
  return '';
}

// Used only for tags that have no native color or if a lookup fails.
const FALLBACK = {
  'essential': '#009688', 'important': '#f59a38', 'optional': '#9ca3af',
  'read-first': '#65b533', 'read-later': '#29a7dc'
};
function tagColor(libraryID, tag) {
  try {
    const color = Zotero.Tags.getColor(Number(libraryID), tag)?.color;
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) return color;
  } catch (error) {
    Zotero.logError(error);
  }
  return FALLBACK[tag] || null;
}
function rgb(hex) {
  return [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
}
function mix(a,b,t) {
  return a.map((n,i) => Math.round(n*(1-t)+b[i]*t));
}
function luminance(a) {
  return a.map(n=>{n/=255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4;}).reduce((v,n,i)=>v+n*[0.2126,0.7152,0.0722][i],0);
}
function contrast(a,b) {
  const x=luminance(a), y=luminance(b);
  return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);
}
function cssRGB(a) { return `rgb(${a.join(', ')})`; }
function renderCell(index, data, column, isFirstColumn, doc, field) {
  const cell = doc.createElement('span');
  cell.className = `cell ${column.className}`;
  const text = doc.createElement('span');
  text.className = 'cell-text';
  const parts = String(data ?? '').split('|');
  const label = parts.length > 1 ? parts[1] : parts[0];
  text.textContent = label;
  if (label && field !== 'priority') {
    const color = parts[3] ? tagColor(parts[2], parts[3]) : null;
    if (color) {
      const raw = rgb(color);
      let dark = false;
      try { dark = doc.defaultView.matchMedia('(prefers-color-scheme: dark)').matches; } catch (_) {}
      const base = dark ? [30,30,30] : [255,255,255];
      const bg = mix(base, raw, dark ? 0.21 : 0.14);
      let fg = raw;
      const target = dark ? [255,255,255] : [0,0,0];
      for (let i=1; contrast(fg,bg)<4.5 && i<=20; i++) fg = mix(raw,target,i/20);
      const styles = {
        'color': cssRGB(fg), 'background-color': cssRGB(bg),
        'font-weight': '500', 'font-size': '0.92em', 'line-height': '1.4',
        'border-radius': '999px', 'padding': '1px 8px',
        'display': 'inline-block', 'max-width': '100%', 'min-width': '0',
        'flex': '0 1 auto', 'box-sizing': 'border-box',
        'white-space': 'nowrap', 'overflow': 'hidden', 'text-overflow': 'ellipsis'
      };
      for (const [key,value] of Object.entries(styles)) text.style.setProperty(key,value,'important');
      text.title = label;
    }
  }
  cell.appendChild(text);
  return cell;
}

async function startup({ id }) {
  const manager = Zotero.ItemTreeManager;
  const definitions = [
    ['importance', 'Importance', '100'],
    ['urgency', 'Reading Priority', '120'],
    ['order', 'Order', '65'],
    ['priority', 'Priority', '65']
  ];
  try {
    for (const [field, label, width] of definitions) {
      const key = await manager.registerColumn({
        dataKey: 'reading-' + field,
        label,
        pluginID: id,
        enabledTreeIDs: ['main'],
        flex: 0,
        width,
        showInColumnPicker: true,
        dataProvider: item => columnValue(item, field),
        renderCell: function(index, data, column, isFirstColumn, doc) {
          return renderCell.call(this, index, data, column, isFirstColumn, doc, field);
        },
        zoteroPersist: ['width', 'hidden', 'sortDirection']
      });
      if (!key) throw new Error('Could not register ' + label);
      registeredKeys.push(key);
    }
  } catch (error) {
    await unregisterAll();
    Zotero.logError(error);
    throw error;
  }
}

async function unregisterAll() {
  for (const key of registeredKeys.splice(0)) {
    try { await Zotero.ItemTreeManager.unregisterColumn(key); }
    catch (error) { Zotero.logError(error); }
  }
}
async function shutdown(data, reason) {
  if (typeof APP_SHUTDOWN !== 'undefined' && reason === APP_SHUTDOWN) return;
  await unregisterAll();
}
function install() {}
function uninstall() {}
