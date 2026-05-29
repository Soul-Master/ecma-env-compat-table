import editions from '../data/edition-mapping.json' with { type: "json" };

const BCD_URL = "https://unpkg.com/@mdn/browser-compat-data/data.json";
const EDGE_CHROMIUM_VERSION = "79";

const columns = [
    { id: "chrome", label: "Chrome", browserIds: ["chrome"] },
    { id: "edge", label: "Edge", browserIds: ["edge"] },
    { id: "safari", label: "Safari", browserIds: ["safari"] },
    { id: "firefox", label: "Firefox", browserIds: ["firefox"] },
    { id: "nodejs", label: "Node.js", browserIds: ["nodejs"] },
];
const app = document.querySelector("#app");
const filter = document.querySelector("#filter");
const hideUnknown = document.querySelector("#hideUnknown");
const reload = document.querySelector("#reload");
const expandAll = document.querySelector("#expandAll");
const collapseAll = document.querySelector("#collapseAll");
const status = document.querySelector("#status");

let bcd = null;
let resolvedEditions = [];
let expandedYears = new Set([editions[0].year]);
let rowPointerDown = null;

reload.addEventListener("click", () => load(true));
filter.addEventListener("input", () => {
    const q = filter.value.trim();
    if (q) expandedYears = new Set(editions.map(e => e.year));
    render();
});
hideUnknown.addEventListener("change", render);
expandAll.addEventListener("click", () => { expandedYears = new Set(editions.map(e => e.year)); render(); });
collapseAll.addEventListener("click", () => { expandedYears = new Set(); render(); });
app.addEventListener("pointerdown", event => {
    const row = getParentRow(event);
    rowPointerDown = row ? { x: event.clientX, y: event.clientY } : null;
});
app.addEventListener("click", event => {
    const row = getParentRow(event);
    if (!row) return;
    if (isSelectingText(event)) return;

    toggleYear(Number(row.getAttribute("data-toggle-year")));
});

await load(false);

async function load(force) {
    status.textContent = force ? "Reloading compatibility data…" : "Loading compatibility data…";
    app.innerHTML = "";

    try {
        const url = force ? `${BCD_URL}?t=${Date.now()}` : BCD_URL;
        const res = await fetch(url, { cache: force ? "reload" : "default" });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

        bcd = await res.json();
        resolvedEditions = editions
            .map(edition => ({
                ...edition,
                features: edition.features.map(resolveFeature),
            }))
            .sort((a, b) => b.year - a.year);

        status.hidden = true;
        render();
    } catch (err) {
        status.hidden = false;
        status.textContent = "Failed to load BCD";
    }
}

function resolveFeature(feature) {
    const resolvedPaths = feature.paths
        .map(path => [path, getByPath(bcd, path)])
        .filter(([, value]) => value?.__compat);

    return {
        ...feature,
        resolvedPaths: resolvedPaths.map(([path]) => path),
        mdnUrl: resolvedPaths.map(([, value]) => value.__compat.mdn_url).find(Boolean) ?? null,
        support: Object.fromEntries(
            columns.map(column => [column.id, aggregateCompatForColumn(resolvedPaths.map(([, value]) => value.__compat), column)])
        ),
    };
}

function aggregateCompatForColumn(compats, column) {
    if (!compats.length) return summarizeColumn(null, column);

    const summaries = compats.map(compat => summarizeColumn(compat, column));
    return aggregateMaximum(summaries, column);
}

function summarizeColumn(compat, column) {
    const parts = column.browserIds.map(browserId => {
        const support = summarizeSupport(compat?.support?.[browserId], browserId);
        return { browserId, ...support };
    });

    if (column.browserIds.length === 1) return parts[0];

    return {
        state: aggregateState(parts),
        text: parts.map(p => `${labelForBrowser(p.browserId)} ${p.text}`).join(" / "),
        notes: parts.map(p => p.notes ? `${labelForBrowser(p.browserId)}: ${p.notes}` : "").filter(Boolean).join("; "),
        parts,
    };
}

function summarizeEdition(edition) {
    return Object.fromEntries(columns.map(column => {
        const childSupports = edition.features.map(feature => feature.support[column.id]);
        return [column.id, aggregateMaximum(childSupports, column)];
    }));
}

function aggregateMaximum(items, column) {
    if (column.browserIds.length > 1) {
        const byBrowser = column.browserIds.map(browserId => {
            const childBrowserItems = items
                .map(item => item.parts?.find(p => p.browserId === browserId))
                .filter(Boolean);
            return { browserId, ...aggregateMaximum(childBrowserItems, { browserIds: [browserId] }) };
        });

        return {
            state: aggregateState(byBrowser),
            text: byBrowser.map(p => `${labelForBrowser(p.browserId)} ${p.text}`).join(" / "),
            notes: "",
            parts: byBrowser,
        };
    }

    const usable = items.filter(item => item.numericParts?.length);
    if (!usable.length) {
        return {
            state: items.some(item => item.state === "unsupported") ? "unsupported" : "unknown",
            text: items.some(item => item.state === "unsupported") ? "No" : "Unknown",
            notes: "",
            numericParts: [],
        };
    }

    const max = usable.reduce((a, b) => compareVersions(a.text, b.text) >= 0 ? a : b);
    return {
        state: aggregateState(items),
        text: max.text,
        notes: "",
        numericParts: max.numericParts,
    };
}

function aggregateState(items) {
    if (items.some(item => item.state === "unknown")) return "unknown";
    if (items.some(item => item.state === "unsupported")) return "unsupported";
    if (items.some(item => item.state === "partial")) return "partial";
    return "supported";
}

function getByPath(root, path) {
    return path.split(".").reduce((node, key) => node?.[key], root);
}

function summarizeSupport(value, browserId) {
    if (!value) return { state: "unknown", text: "Unknown", notes: "", numericParts: [] };

    const entries = normalizeSupportEntries(value, browserId);

    const usable = entries
        .filter(entry => entry && entry.version_added && entry.version_added !== false)
        .filter(entry => !entry.flags && !entry.prefix && !entry.alternative_name)
        .sort((a, b) => compareVersions(String(a.version_added), String(b.version_added)));

    const full = usable.find(entry => entry.partial_implementation !== true);
    const partial = usable.find(entry => entry.partial_implementation === true);
    const chosen = full ?? partial;

    if (!chosen) {
        const hasExplicitNo = entries.some(entry => entry?.version_added === false);
        return {
            state: hasExplicitNo ? "unsupported" : "unknown",
            text: hasExplicitNo ? "No" : "Unknown",
            notes: "",
            numericParts: [],
        };
    }

    const text = String(chosen.version_added);
    const notes = [
        chosen.partial_implementation ? "partial implementation" : "",
        chosen.version_removed ? `removed in ${chosen.version_removed}` : "",
        chosen.notes ? normalizeNotes(chosen.notes) : "",
    ].filter(Boolean).join("; ");

    return {
        state: chosen.partial_implementation ? "partial" : "supported",
        text,
        notes,
        numericParts: parseVersion(text),
    };
}

function normalizeSupportEntries(value, browserId) {
    const entries = Array.isArray(value) ? value : [value];
    if (browserId !== "edge") return entries;

    return entries.map(entry => {
        if (!entry || entry.version_added === false) return entry;
        if (entry.version_added === true) return entry;

        const versionAdded = String(entry.version_added);
        const versionRemoved = entry.version_removed ? String(entry.version_removed) : null;

        if (versionRemoved && compareVersions(versionRemoved, EDGE_CHROMIUM_VERSION) <= 0) {
            return { ...entry, version_added: false };
        }

        if (compareVersions(versionAdded, EDGE_CHROMIUM_VERSION) < 0) {
            return { ...entry, version_added: EDGE_CHROMIUM_VERSION };
        }

        return entry;
    });
}

function compareVersions(a, b) {
    const pa = parseVersion(a);
    const pb = parseVersion(b);

    if (!pa.length && !pb.length) return String(a).localeCompare(String(b));
    if (!pa.length) return -1;
    if (!pb.length) return 1;

    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const delta = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (delta) return delta;
    }

    return String(a).localeCompare(String(b));
}

function parseVersion(value) {
    return String(value)
        .replace(/^≤/, "")
        .replace(/^preview$/i, "9999")
        .split(/[^\d]+/)
        .filter(Boolean)
        .map(Number);
}

function normalizeNotes(notes) {
    const flat = Array.isArray(notes) ? notes.join(" ") : String(notes);
    return flat.replace(/\s+/g, " ").trim();
}

function labelForBrowser(browserId) {
    switch (browserId) {
    case "chrome": return "Chrome";
    case "edge": return "Edge";
    case "safari": return "Safari";
    case "firefox": return "Firefox";
    case "nodejs": return "Node";
    default: return browserId;
    }
}

function getVisibleEditions() {
    const q = filter.value.trim().toLowerCase();

    return resolvedEditions
        .map(edition => {
            const features = edition.features.filter(feature => {
                if (hideUnknown.checked && feature.resolvedPaths.length === 0) return false;
                const haystack = feature.name.toLowerCase();
                return !q || haystack.includes(q);
            });
            return { ...edition, features };
        })
        .filter(edition => edition.features.length > 0 || !q);
}

function render() {
    const visibleEditions = getVisibleEditions();

    if (!visibleEditions.length) {
        app.innerHTML = `<div class="error">No rows match the current filter.</div>`;
        return;
    }

    app.innerHTML = `
    <div class="table-wrap">
        <table>
        <thead>
            <tr>
            <th class="feature-col">Feature</th>
            ${columns.map(c => `<th class="version-col">${escapeHtml(c.label)}</th>`).join("")}
            </tr>
        </thead>
        <tbody>
            ${visibleEditions.map(renderEditionBlock).join("")}
        </tbody>
        </table>
    </div>
    `;

}

function toggleYear(year) {
    if (expandedYears.has(year)) expandedYears.delete(year);
    else expandedYears.add(year);
    render();
}

function getParentRow(event) {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    return target?.closest(".parent-row[data-toggle-year]") ?? null;
}

function isSelectingText(event) {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) return true;
    if (!rowPointerDown) return false;

    const dx = Math.abs(event.clientX - rowPointerDown.x);
    const dy = Math.abs(event.clientY - rowPointerDown.y);
    return dx > 4 || dy > 4;
}

function renderEditionBlock(edition) {
    const isExpanded = expandedYears.has(edition.year);
    const support = summarizeEdition(edition);

    return `
    ${renderParentRow(edition, support, isExpanded)}
    ${isExpanded ? edition.features.map(feature => renderFeatureRow(feature)).join("") : ""}
    `;
}

function renderParentRow(edition, support, isExpanded) {
    return `<tr class="parent-row" data-toggle-year="${edition.year}">
    <td>
        <div class="tree-cell edition-sticky">
        <button class="twisty" type="button" aria-expanded="${isExpanded}" aria-label="${isExpanded ? "Collapse" : "Expand"} ${escapeHtml(edition.name)}">
            <span class="closed">▶</span>
            <span class="open">▼</span>
        </button>
        <div>
            <span class="name">${escapeHtml(edition.name)} (${edition.features.length} feature${edition.features.length === 1 ? "" : "s"})</span>
        </div>
        </div>
    </td>
    ${columns.map(c => renderSupportCell(support[c.id])).join("")}
    </tr>`;
}

function renderFeatureRow(feature) {
    const query = filter.value.trim();
    const featureName = highlightMatches(feature.name, query);
    const featureTooltip = escapeHtml(`${feature.kind}\n${feature.description}`);
    // const featurePaths = `BCD: ${feature.resolvedPaths.length ? feature.resolvedPaths.map(path => `${escapeHtml(path)}`).join(", ") : "unresolved from configured paths"}`;
    const nameMarkup = feature.mdnUrl
        ? `<a class="name feature-link" href="${escapeHtml(feature.mdnUrl)}" target="_blank" rel="noreferrer" title="${featureTooltip}">${featureName}</a>`
        : `<span class="name" title="${featureTooltip}">${featureName}</span>`;

    return `<tr class="sub-feature">
    <td>
        <div class="tree-cell">
        <div>
            ${nameMarkup}
            <span class="meta">${escapeHtml(feature.kind)}</span>
        </div>
        </div>
    </td>
    ${columns.map(c => renderSupportCell(feature.support[c.id])).join("")}
    </tr>`;
}

function renderSupportCell(support) {
    return `<td>
    <span class="version ${support.state}">${icon(support.state)} ${escapeHtml(support.text)}</span>
    ${support.notes ? `<div class="notes">${escapeHtml(support.notes)}</div>` : ""}
    </td>`;
}

function icon(state) {
    switch (state) {
    case "supported": return "✓";
    case "partial": return "◐";
    case "unsupported": return "✕";
    default: return "?";
    }
}

function highlightMatches(value, query) {
    const text = String(value);
    const normalizedQuery = String(query ?? "").trim();
    if (!normalizedQuery) return escapeHtml(text);

    const escapedText = escapeHtml(text);
    const terms = [...new Set(normalizedQuery.split(/\s+/).map(term => term.trim()).filter(Boolean))];
    if (!terms.length) return escapedText;

    const pattern = terms.map(escapeRegExp).sort((a, b) => b.length - a.length).join("|");
    return escapedText.replace(new RegExp(`(${pattern})`, "gi"), "<mark class=\"highlight\">$1</mark>");
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
