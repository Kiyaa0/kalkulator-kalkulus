/**
 * =============================================================================
 * CalcKu — Main Client-Side Logic (Clean, Modular & Comprehensive)
 * =============================================================================
 * Architecture Overview:
 * 1. Core Utilities & DOM Selectors
 * 2. Theme Manager (Dark / Light Mode)
 * 3. Tab Navigation & View Switcher
 * 4. Input Helpers, Auto-Fix & Live Syntax Hinting
 * 5. History Store (LocalStorage for Turunan, Integral, Limit)
 * 6. LaTeX & Result Renderer (KaTeX + Multi-Line Formatting)
 * 7. Calculus API Handlers (Turunan, Integral, Limit)
 * 8. Interactive Function Plotter (function-plot canvas, zoom, multi-curve, SVG/PNG)
 * 9. Matrix Calculator Engine:
 *    - State & Dimension Management
 *    - Dynamic Matrix Cards & Bracket Grid Generator
 *    - Spreadsheet-like Keyboard Navigation
 *    - Foolproof Live Compatibility Assistant
 *    - Binary (Add, Sub, Mul, Div), Unary (Inv, Det, Transpose), & Scalar Controllers
 *    - Step-by-Step LaTeX Explanation Generator
 *    - Preset Loader & Result Variable Storing
 * 10. Accordion & Documentation Guides (Global + Per-Card)
 * 11. Hero Formula Track Animations & Keyboard Shortcuts
 * 12. Global Window Exports & App Initialization
 * =============================================================================
 */

// =============================================================================
// SECTION 1: CORE UTILITIES & DOM SELECTORS
// =============================================================================
const $ = (id) => document.getElementById(id);
const LS_H = 'calcku-h';
const last = {};
const plotSvgCache = {};

/**
 * Higher-order debounce helper to rate-limit input event handlers.
 */
function debounce(fn, delay) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

/**
 * Auto-correct common mathematical input typos (e.g., missing '*' before variables/brackets).
 */
function autoFix(str) {
    if (!str) return '';
    return str
        .replaceAll('^', '**')
        .replace(/(\d)([a-zA-Z])/g, '$1*$2')
        .replace(/([xy])\(/g, '$1*(')
        .replace(/\)\(/g, ')*(')
        .replace(/\)([a-zA-Z])/g, ')*$1')
        .replace(/(\d)\(/g, '$1*(');
}

/**
 * Checks if string likely contains missing multiplication operators.
 */
function hasMissingStar(str) {
    return /(\d[a-zA-Z]|\d\(|[xy]\(|\)[a-zA-Z0-9(])/.test(str);
}

/**
 * Converts a math expression to a function-plot compatible evaluator format.
 */
function toPlotExpr(str) {
    if (!str || !str.trim()) return '';
    let expr = str.trim();
    if (expr.includes('=')) {
        // Strip left-hand assignments e.g. "y = x^2" or "f(x) = x^2"
        expr = expr.split('=').pop().trim();
    }
    expr = autoFix(expr);
    expr = expr.replaceAll('**', '^');

    // If expression uses variable 'y' and not 'x', normalize 'y' -> 'x' for 2D Cartesian plot
    if (/\by\b/.test(expr) && !/\bx\b/.test(expr)) {
        expr = expr.replace(/\by\b/g, 'x');
    }

    // Convert e^... to exp(...)
    expr = expr.replace(/\be\s*\^\s*(\([^\)]+\)|[a-zA-Z0-9]+)/gi, (match, p1) => {
        return p1.startsWith('(') ? `exp${p1}` : `exp(${p1})`;
    });

    // Replace mathematical constants and function aliases
    expr = expr.replace(/\bpi\b/gi, 'PI');
    expr = expr.replace(/\bln\b/g, 'log');
    expr = expr.replace(/\bAbs\b/gi, 'abs');
    expr = expr.replace(/\bE\b/g, '2.718281828459045');

    return expr;
}

/**
 * Checks whether an expression is syntactically balanced and safe to evaluate in functionPlot.
 */
function isValidPlotExpr(expr) {
    if (!expr || !expr.trim()) return false;
    const s = expr.trim();
    let balance = 0;
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '(') balance++;
        else if (s[i] === ')') balance--;
        if (balance < 0) return false;
    }
    if (balance !== 0) return false;

    // Reject incomplete trailing operators (when user is mid-typing)
    if (/[\+\-\*\/\^\,\.]$/.test(s)) return false;

    return true;
}

// =============================================================================
// SECTION 2: THEME MANAGER (DARK / LIGHT MODE)
// =============================================================================
(function initTheme() {
    const saved = localStorage.getItem('calcku-theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcons(saved);
})();

function updateThemeIcons(theme) {
    const moon = $('icon-moon');
    const sun = $('icon-sun');
    if (!moon || !sun) return;

    if (theme === 'dark') {
        moon.style.display = 'none';
        sun.style.display = 'block';
    } else {
        moon.style.display = 'block';
        sun.style.display = 'none';
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
        meta.content = theme === 'dark' ? '#07090f' : '#ffffff';
    }
}

const themeToggleBtn = $('theme-toggle-btn');
if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', function () {
        const html = document.documentElement;
        const current = html.getAttribute('data-theme') || 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        localStorage.setItem('calcku-theme', next);
        updateThemeIcons(next);
        try {
            if (document.querySelector('.tab[data-tab="grafik"].active')) {
                renderGrafik();
            }
        } catch (e) { }
    });
}

// =============================================================================
// SECTION 3: TAB NAVIGATION & VIEW SWITCHER
// =============================================================================
document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => {
            t.classList.remove('active');
            t.setAttribute('aria-selected', 'false');
        });
        document.querySelectorAll('.card[id^="form-"]').forEach((c) => {
            c.classList.add('hidden');
        });

        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        const activeTabKey = tab.dataset.tab;
        const card = $('form-' + activeTabKey);
        if (card) {
            card.classList.remove('hidden');
            card.classList.add('card-enter');
            requestAnimationFrame(() => {
                requestAnimationFrame(() => card.classList.remove('card-enter'));
            });
        }

        try {
            renderHistory(activeTabKey);
        } catch (e) { }

        if (activeTabKey === 'grafik') {
            requestAnimationFrame(() => {
                initGrafik();
                renderGrafik();
            });
        }
        if (activeTabKey === 'matriks') initMatrixTab();
    });
});

// =============================================================================
// SECTION 4: INPUT HELPERS, AUTO-FIX & LIVE SYNTAX HINTING
// =============================================================================
function fillField(id, val) {
    const el = $(id);
    if (!el) return;
    el.value = val;
    el.dispatchEvent(new Event('input'));
    el.focus();
}

function fillTurunan(val) { fillField('turunan-fungsi', val); }
function fillIntegral(val) { fillField('integral-fungsi', val); }
function fillLimit(val) { fillField('limit-fungsi', val); }

function fillActive(symbol) {
    const activeTab = document.querySelector('.tab.active')?.dataset.tab || 'turunan';
    if (activeTab === 'grafik') {
        const inputs = document.querySelectorAll('#grafik-list .grafik-input');
        let targetInput = document.activeElement && document.activeElement.classList.contains('grafik-input')
            ? document.activeElement
            : (inputs[inputs.length - 1] || null);

        if (!targetInput) {
            addGrafikRow(symbol, true);
            saveGrafikState();
            renderGrafik();
            return;
        }
        const cursor = targetInput.selectionStart || targetInput.value.length;
        const before = targetInput.value.slice(0, cursor);
        const after = targetInput.value.slice(targetInput.selectionEnd || cursor);
        const needStar = before && /[0-9xy\)]$/.test(before) && /^[a-zA-Z]/.test(symbol) ? '*' : '';

        targetInput.value = before + needStar + symbol + after;
        targetInput.focus();
        const nextPos = cursor + symbol.length + (needStar ? 1 : 0);
        targetInput.setSelectionRange(nextPos, nextPos);
        targetInput.dispatchEvent(new Event('input'));
        saveGrafikState();
        renderGrafik();
        return;
    }

    const fieldMap = {
        turunan: 'turunan-fungsi',
        integral: 'integral-fungsi',
        limit: 'limit-fungsi'
    };
    const inputEl = $(fieldMap[activeTab]);
    if (!inputEl) return;

    const cursor = inputEl.selectionStart || inputEl.value.length;
    const before = inputEl.value.slice(0, cursor);
    const after = inputEl.value.slice(inputEl.selectionEnd || cursor);
    const needStar = before && /[0-9xy\)]$/.test(before) && /^[a-zA-Z]/.test(symbol) ? '*' : '';

    inputEl.value = before + needStar + symbol + after;
    inputEl.focus();
    const nextPos = cursor + symbol.length + (needStar ? 1 : 0);
    inputEl.setSelectionRange(nextPos, nextPos);
    inputEl.dispatchEvent(new Event('input'));
}

function showValid(tab, message, fixValue) {
    const el = $('valid-' + tab);
    if (!el) return;
    if (!message) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
    }
    el.classList.remove('hidden');
    el.innerHTML = `
        <div class="valid-hint">
            <span>${message}</span>
            ${fixValue ? `<button type="button" onclick="autoFixAndFocus('${tab}')" class="fix-btn">Fix → ${fixValue}</button>` : ''}
        </div>
    `;
}

function autoFixAndFocus(tab) {
    const fieldMap = {
        turunan: 'turunan-fungsi',
        integral: 'integral-fungsi',
        limit: 'limit-fungsi'
    };
    const inputId = fieldMap[tab];
    const el = $(inputId);
    if (!el) return;
    const fixed = autoFix(el.value);
    el.value = fixed;
    el.dispatchEvent(new Event('input'));
    el.focus();
    showValid(tab, '', '');
}

function bindValidationListener(inputId, tab) {
    const el = $(inputId);
    if (!el) return;
    el.addEventListener('input', debounce(() => {
        const val = el.value.trim();
        if (!val) {
            showValid(tab, '', '');
            return;
        }
        if (hasMissingStar(val)) {
            const fixed = autoFix(val);
            showValid(tab, `Terlihat <code>${val}</code> — mungkin maksud <code>${fixed}</code> ?`, fixed);
        } else {
            showValid(tab, '', '');
        }
    }, 220));
}

bindValidationListener('turunan-fungsi', 'turunan');
bindValidationListener('integral-fungsi', 'integral');
bindValidationListener('limit-fungsi', 'limit');

// =============================================================================
// SECTION 5: HISTORY STORE (LOCALSTORAGE FOR TURUNAN, INTEGRAL, LIMIT)
// =============================================================================
function loadH() {
    try {
        return JSON.parse(localStorage.getItem(LS_H) || '{}');
    } catch (e) {
        return {};
    }
}

function saveH(obj) {
    try {
        localStorage.setItem(LS_H, JSON.stringify(obj));
    } catch (e) { }
}

function pushHistory(tab, input, latex) {
    if (!latex || latex.includes('Gagal')) return;
    const h = loadH();
    h[tab] = h[tab] || [];
    h[tab].unshift({ input, latex, t: Date.now() });
    h[tab] = h[tab].slice(0, 5); // Keep up to 5 latest calculations
    saveH(h);
    renderHistory(tab);
}

function renderHistory(tab) {
    const el = $('history-' + tab);
    if (!el) return;
    const items = (loadH()[tab] || []);
    if (!items.length) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
    }
    el.classList.remove('hidden');
    el.innerHTML = `<div class="history-label">Riwayat (${items.length})</div>`;

    const frag = document.createDocumentFragment();
    items.forEach((item) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'history-item';
        btn.innerHTML = `
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${item.input}</span>
            <span style="flex-shrink:0;color:var(--accent)">↺</span>
        `;
        btn.title = 'Klik untuk isi lagi';
        btn.addEventListener('click', () => {
            const fieldMap = {
                turunan: 'turunan-fungsi',
                integral: 'integral-fungsi',
                limit: 'limit-fungsi'
            };
            const input = $(fieldMap[tab]);
            if (input) {
                input.value = item.input;
                input.dispatchEvent(new Event('input'));
                input.focus();
            }
        });
        frag.appendChild(btn);
    });

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'history-clear';
    clearBtn.textContent = 'Hapus riwayat';
    clearBtn.addEventListener('click', () => {
        const h = loadH();
        h[tab] = [];
        saveH(h);
        renderHistory(tab);
    });
    frag.appendChild(clearBtn);
    el.appendChild(frag);
}

// Initialize history on page load
(() => {
    ['turunan', 'integral', 'limit'].forEach(renderHistory);
    ['turunan-fungsi', 'integral-fungsi', 'limit-fungsi'].forEach((id) => {
        const el = $(id);
        if (el && el.value) el.dispatchEvent(new Event('input'));
    });
})();

// =============================================================================
// SECTION 6: LATEX & RESULT RENDERER (KATEX + MULTI-LINE FORMATTING)
// =============================================================================
function renderLatex(id, latex, isError) {
    const el = $(id);
    if (!el) return;
    el.style.display = 'block';
    el.classList.remove('justify-center');
    if (isError) {
        el.innerHTML = `
            <div class="error-msg">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 8v4M12 16h.01"/>
                </svg>
                <span>${latex}</span>
            </div>
        `;
    } else {
        el.innerHTML = '';
        try {
            katex.render(latex, el, { throwOnError: false, displayMode: true });
        } catch (e) {
            el.textContent = latex;
        }
    }
}

function renderMultiLine(id, lines) {
    const el = $(id);
    if (!el) return;
    el.style.display = 'block';
    el.innerHTML = '';
    el.classList.remove('justify-center');
    const frag = document.createDocumentFragment();
    lines.forEach((latex) => {
        const d = document.createElement('div');
        d.className = 'result-line';
        try {
            katex.render(latex, d, { throwOnError: false, displayMode: true });
        } catch (e) {
            d.textContent = latex;
        }
        frag.appendChild(d);
    });
    el.appendChild(frag);
}

function showPlot(tab, base64) {
    const wrap = $('plot-' + tab);
    const img = $('plot-' + tab + '-img');
    if (wrap && img && base64) {
        img.src = 'data:image/png;base64,' + base64;
        wrap.classList.remove('hidden');
    }
}

function hidePlot(tab) {
    const plotEl = $('plot-' + tab);
    if (plotEl) plotEl.classList.add('hidden');
}

function setLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
        btn.dataset.text = btn.innerHTML;
        btn.innerHTML = '<span class="spinner"></span> Menghitung...';
        btn.disabled = true;
    } else {
        btn.innerHTML = btn.dataset.text || 'Hitung';
        btn.disabled = false;
    }
}

function copyLatex(tab) {
    const latex = last[tab];
    if (!latex) return;
    navigator.clipboard.writeText(latex).then(() => {
        const btn = document.querySelector('#actions-' + tab + ' button');
        if (btn) {
            const original = btn.textContent;
            btn.textContent = '✓ Copied!';
            setTimeout(() => { btn.textContent = original; }, 1200);
        }
    }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = latex;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
    });
}

function toggleDownloadMenu(tab, forceClose) {
    const menu = $('menu-' + tab);
    if (!menu) return;
    if (forceClose) {
        menu.classList.add('hidden');
        return;
    }
    const willShow = menu.classList.contains('hidden');
    document.querySelectorAll('[id^="menu-"]').forEach((m) => m.classList.add('hidden'));
    if (willShow) menu.classList.remove('hidden');
}

document.addEventListener('click', (e) => {
    const isBtn = e.target.closest('[onclick*="toggleDownloadMenu"]');
    const isMenu = e.target.closest('[id^="menu-"]');
    if (!isBtn && !isMenu) {
        document.querySelectorAll('[id^="menu-"]').forEach((m) => m.classList.add('hidden'));
    }
});

function downloadPlotAs(tab, format) {
    const fmt = (format || 'png').toLowerCase();
    if (fmt === 'png') {
        const img = $('plot-' + tab + '-img');
        if (!img || !img.src || !img.src.includes('data:')) {
            alert('Belum ada grafik. Hitung dulu.');
            return;
        }
        const a = document.createElement('a');
        a.href = img.src;
        a.download = `calcku-${tab}-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    } else if (fmt === 'svg') {
        const svg = plotSvgCache[tab];
        if (!svg) {
            alert('Belum ada grafik SVG. Hitung ulang.');
            return;
        }
        const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `calcku-${tab}-${Date.now()}.svg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}

// =============================================================================
// SECTION 7: CALCULUS API HANDLERS (TURUNAN, INTEGRAL, LIMIT)
// =============================================================================
async function calcApi({ endpoint, payload, tab, btnId, resultId, onSuccess }) {
    const btn = $(btnId);
    hidePlot(tab);
    setLoading(btn, true);

    const resultEl = $(resultId);
    if (resultEl) {
        resultEl.innerHTML = '<div class="skeleton-wrap"><div class="skeleton-line w80"></div><div class="skeleton-line w60"></div></div>';
    }

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.sukses) {
            onSuccess(data);
        } else {
            renderLatex(resultId, data.error, true);
        }
    } catch (e) {
        renderLatex(resultId, 'Gagal menghubungi server — cek koneksi atau server aktif', true);
    } finally {
        setLoading(btn, false);
    }
}

async function hitungTurunan() {
    const inputEl = $('turunan-fungsi');
    const fungsi = inputEl ? inputEl.value.trim() : '';
    if (!fungsi) {
        if (inputEl) inputEl.focus();
        return;
    }
    const orde = $('turunan-orde') ? $('turunan-orde').value : 1;
    const titik = $('turunan-titik') ? $('turunan-titik').value.trim() : '';

    await calcApi({
        endpoint: '/api/turunan',
        payload: { fungsi, orde, titik: titik || null },
        tab: 'turunan',
        btnId: 'btn-turunan',
        resultId: 'hasil-turunan',
        onSuccess: (data) => {
            const lines = [data.notasi + ' = ' + data.hasil];
            if (data.evaluasi) {
                lines.push('f^{' + orde + '}(' + data.titik + ') = ' + data.evaluasi);
            }
            renderMultiLine('hasil-turunan', lines);
            last['turunan'] = lines.join(' \\n ');
            if (data.plot) showPlot('turunan', data.plot);
            if (data.plot_svg) plotSvgCache['turunan'] = data.plot_svg;
            const actions = $('actions-turunan');
            if (actions) actions.classList.remove('hidden');
            pushHistory('turunan', fungsi, last['turunan']);
        }
    });
}

async function hitungIntegral() {
    const inputEl = $('integral-fungsi');
    const fungsi = inputEl ? inputEl.value.trim() : '';
    if (!fungsi) {
        if (inputEl) inputEl.focus();
        return;
    }
    const batas_bawah = $('integral-bawah') ? $('integral-bawah').value.trim() : '';
    const batas_atas = $('integral-atas') ? $('integral-atas').value.trim() : '';

    await calcApi({
        endpoint: '/api/integral',
        payload: { fungsi, batas_bawah, batas_atas },
        tab: 'integral',
        btnId: 'btn-integral',
        resultId: 'hasil-integral',
        onSuccess: (data) => {
            const lines = [];
            if (data.tentu) {
                lines.push(data.notasi + ' = ' + data.tentu);
            } else {
                lines.push(data.notasi + ' = ' + data.hasil + ' + C');
            }
            renderMultiLine('hasil-integral', lines);
            last['integral'] = lines.join(' \\n ');
            if (data.plot) showPlot('integral', data.plot);
            if (data.plot_svg) plotSvgCache['integral'] = data.plot_svg;
            const actions = $('actions-integral');
            if (actions) actions.classList.remove('hidden');
            pushHistory('integral', fungsi, last['integral']);
        }
    });
}

async function hitungLimit() {
    const inputEl = $('limit-fungsi');
    const fungsi = inputEl ? inputEl.value.trim() : '';
    if (!fungsi) {
        if (inputEl) inputEl.focus();
        return;
    }
    const titik = $('limit-titik') ? $('limit-titik').value.trim() : '0';
    const arah = $('limit-arah') ? $('limit-arah').value : '+-';

    await calcApi({
        endpoint: '/api/limit',
        payload: { fungsi, titik, arah },
        tab: 'limit',
        btnId: 'btn-limit',
        resultId: 'hasil-limit',
        onSuccess: (data) => {
            const line = data.notasi + ' = ' + data.hasil;
            renderMultiLine('hasil-limit', [line]);
            last['limit'] = line;
            if (data.plot) showPlot('limit', data.plot);
            if (data.plot_svg) plotSvgCache['limit'] = data.plot_svg;
            const actions = $('actions-limit');
            if (actions) actions.classList.remove('hidden');
            pushHistory('limit', fungsi, line);
        }
    });
}

// =============================================================================
// SECTION 8: INTERACTIVE FUNCTION PLOTTER (FUNCTION-PLOT ENGINE)
// =============================================================================
const LS_GRAFIK = 'calcku-grafik-v1';
const GRAFIK_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6'];
let grafikInited = false;
let isZoomingPlot = false;
let activePlotInstance = null;

function getGrafikFns() {
    return Array.from(document.querySelectorAll('#grafik-list .grafik-input'))
        .map((i) => i.value.trim())
        .filter(Boolean);
}

function saveGrafikState() {
    try {
        const data = {
            fns: Array.from(document.querySelectorAll('#grafik-list .grafik-input')).map((i) => i.value),
            xmin: $('grafik-xmin') ? $('grafik-xmin').value : '-10',
            xmax: $('grafik-xmax') ? $('grafik-xmax').value : '10',
            ymin: $('grafik-ymin') ? $('grafik-ymin').value : '-10',
            ymax: $('grafik-ymax') ? $('grafik-ymax').value : '10',
            grid: $('grafik-grid') ? $('grafik-grid').checked : true
        };
        localStorage.setItem(LS_GRAFIK, JSON.stringify(data));
    } catch (e) { }
}

const debouncedSaveGrafikState = debounce(saveGrafikState, 300);

function loadGrafikState() {
    let state = null;
    try {
        const raw = localStorage.getItem(LS_GRAFIK);
        if (raw) state = JSON.parse(raw);
    } catch (e) { }

    try {
        const match = location.hash.match(/#grafik=([^&]+)/);
        if (match) {
            const parsed = JSON.parse(decodeURIComponent(match[1]));
            if (Array.isArray(parsed) && parsed.length) {
                state = state || {};
                state.fns = parsed;
            } else if (parsed && typeof parsed === 'object') {
                state = state || {};
                if (Array.isArray(parsed.fns)) state.fns = parsed.fns;
                if (parsed.xmin !== undefined) state.xmin = parsed.xmin;
                if (parsed.xmax !== undefined) state.xmax = parsed.xmax;
                if (parsed.ymin !== undefined) state.ymin = parsed.ymin;
                if (parsed.ymax !== undefined) state.ymax = parsed.ymax;
            }
        }
    } catch (e) { }
    return state;
}

function addGrafikRow(val = '', focus = true) {
    const list = $('grafik-list');
    if (!list) return null;
    const idx = list.children.length;
    const color = GRAFIK_COLORS[idx % GRAFIK_COLORS.length];
    const row = document.createElement('div');
    row.className = 'grafik-row';
    row.innerHTML = `
        <span class="grafik-dot" style="background:${color}"></span>
        <input type="text" placeholder="contoh: x^2, sin(x)/x, cos(x)" autocomplete="off" spellcheck="false" class="grafik-input" value="${val.replace(/"/g, '&quot;')}">
        <button type="button" class="grafik-del" title="Hapus" aria-label="Hapus">×</button>
    `;
    const inp = row.querySelector('input');
    const del = row.querySelector('button');
    const debouncedRender = debounce(() => {
        saveGrafikState();
        renderGrafik();
    }, 200);

    inp.addEventListener('input', debouncedRender);
    inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveGrafikState();
            renderGrafik();
        }
        if (e.key === 'Escape') inp.blur();
    });
    del.addEventListener('click', () => {
        row.remove();
        document.querySelectorAll('#grafik-list .grafik-dot').forEach((d, i) => {
            d.style.background = GRAFIK_COLORS[i % GRAFIK_COLORS.length];
        });
        if (!list.children.length) addGrafikRow('', true);
        saveGrafikState();
        renderGrafik();
    });

    list.appendChild(row);
    if (focus) inp.focus();
    return row;
}

function addGrafikPreset(val) {
    const list = $('grafik-list');
    if (!list) return;
    const inputs = list.querySelectorAll('.grafik-input');
    if (inputs.length && !inputs[inputs.length - 1].value.trim()) {
        inputs[inputs.length - 1].value = val;
        inputs[inputs.length - 1].dispatchEvent(new Event('input'));
        inputs[inputs.length - 1].focus();
    } else {
        addGrafikRow(val, true);
    }
    saveGrafikState();
    renderGrafik();
}

function setGrafikRange(xmin, xmax, ymin, ymax) {
    const xminEl = $('grafik-xmin');
    const xmaxEl = $('grafik-xmax');
    const yminEl = $('grafik-ymin');
    const ymaxEl = $('grafik-ymax');
    if (xminEl) xminEl.value = xmin;
    if (xmaxEl) xmaxEl.value = xmax;
    if (yminEl && ymin !== undefined) yminEl.value = ymin;
    if (ymaxEl && ymax !== undefined) ymaxEl.value = ymax;
    saveGrafikState();
    renderGrafik();
}

function getValidDomains() {
    let xmin = parseFloat($('grafik-xmin')?.value);
    let xmax = parseFloat($('grafik-xmax')?.value);
    let ymin = parseFloat($('grafik-ymin')?.value);
    let ymax = parseFloat($('grafik-ymax')?.value);

    const warnEl = $('grafik-range-warning');
    let warnings = [];

    if (!isFinite(xmin)) xmin = -10;
    if (!isFinite(xmax)) xmax = 10;
    if (!isFinite(ymin)) ymin = -10;
    if (!isFinite(ymax)) ymax = 10;

    if (xmin >= xmax) {
        warnings.push(`xMin (${xmin}) harus lebih kecil dari xMax (${xmax}).`);
        // Clamp for rendering so function-plot never crashes on division by zero
        xmax = xmin + 2;
    }
    if (ymin >= ymax) {
        warnings.push(`yMin (${ymin}) harus lebih kecil dari yMax (${ymax}).`);
        // Clamp for rendering so function-plot never crashes
        ymax = ymin + 2;
    }

    if (warnEl) {
        if (warnings.length) {
            warnEl.innerHTML = `⚠️ <span>${warnings.join(' ')}</span>`;
            warnEl.classList.remove('hidden');
        } else {
            warnEl.innerHTML = '';
            warnEl.classList.add('hidden');
        }
    }

    return {
        xDomain: [xmin, xmax],
        yDomain: [ymin, ymax]
    };
}

function clearGrafikError() {
    const e = $('grafik-error');
    if (!e) return;
    e.classList.add('hidden');
    e.textContent = '';
}

function showGrafikError(msg) {
    const e = $('grafik-error');
    if (!e) return;
    e.textContent = msg;
    e.classList.remove('hidden');
}

const renderGrafik = debounce(() => {
    const wrap = $('grafik-canvas');
    const empty = $('grafik-empty');
    if (!wrap || !empty) return;

    // 1. Guard against hidden container (0 width) when switching tabs
    const isTabActive = !!document.querySelector('.tab[data-tab="grafik"].active');
    if (!isTabActive && wrap.offsetParent === null) {
        return;
    }

    // 2. Measure actual geometry
    const wrapParent = $('grafik-canvas-wrap');
    const w = Math.floor(wrap.clientWidth || (wrapParent ? wrapParent.clientWidth : 0) || 600);
    if (w < 60) {
        // Layout reflow in progress, re-schedule on next animation frame
        requestAnimationFrame(() => renderGrafik());
        return;
    }

    // 3. Collect and validate functions individually
    const inputs = document.querySelectorAll('#grafik-list .grafik-input');
    const validData = [];
    let hasValidFns = false;

    inputs.forEach((inputEl, idx) => {
        const raw = inputEl.value.trim();
        if (!raw) {
            inputEl.style.borderColor = '';
            return;
        }
        const clean = toPlotExpr(raw);
        if (!isValidPlotExpr(clean)) {
            // Keep previous valid curves visible while user is still typing an operator
            inputEl.style.borderColor = 'var(--warning-border, #fde68a)';
            return;
        }
        inputEl.style.borderColor = '';
        hasValidFns = true;
        validData.push({
            fn: clean,
            color: GRAFIK_COLORS[idx % GRAFIK_COLORS.length],
            graphType: 'polyline'
        });
    });

    if (!hasValidFns) {
        wrap.innerHTML = '';
        empty.classList.remove('hidden');
        clearGrafikError();
        return;
    }

    empty.classList.add('hidden');
    clearGrafikError();

    // 4. Validate xmin / xmax / ymin / ymax domains safely
    const { xDomain, yDomain } = getValidDomains();
    const withGrid = $('grafik-grid') ? $('grafik-grid').checked : true;
    const plotHeight = Math.min(420, Math.max(280, window.innerWidth < 480 ? 290 : 380));

    try {
        if (typeof functionPlot === 'undefined') {
            showGrafikError('Library grafik (function-plot) belum termuat. Cek koneksi internet Anda.');
            return;
        }

        wrap.innerHTML = '';
        const instance = functionPlot({
            target: '#grafik-canvas',
            width: w,
            height: plotHeight,
            xAxis: { domain: xDomain },
            yAxis: { domain: yDomain },
            grid: withGrid,
            disableZoom: false,
            data: validData,
            tip: { xLine: true, yLine: true }
        });

        activePlotInstance = instance;

        // 5. Real-time bi-directional zoom & pan synchronization
        try {
            instance.on('all:zoom', (xScale, yScale) => {
                isZoomingPlot = true;
                const xd = xScale.domain();
                const yd = yScale.domain();
                const xminEl = $('grafik-xmin');
                const xmaxEl = $('grafik-xmax');
                const yminEl = $('grafik-ymin');
                const ymaxEl = $('grafik-ymax');

                if (xminEl && document.activeElement !== xminEl) {
                    xminEl.value = Math.round(xd[0] * 100) / 100;
                }
                if (xmaxEl && document.activeElement !== xmaxEl) {
                    xmaxEl.value = Math.round(xd[1] * 100) / 100;
                }
                if (yminEl && document.activeElement !== yminEl) {
                    yminEl.value = Math.round(yd[0] * 100) / 100;
                }
                if (ymaxEl && document.activeElement !== ymaxEl) {
                    ymaxEl.value = Math.round(yd[1] * 100) / 100;
                }
                debouncedSaveGrafikState();
                setTimeout(() => { isZoomingPlot = false; }, 200);
            });
        } catch (e) { }

        // 6. Coordinates cursor display
        const svg = wrap.querySelector('svg');
        if (svg) {
            const coords = $('grafik-coords');
            if (coords) {
                coords.classList.remove('hidden');
                svg.addEventListener('mousemove', (e) => {
                    const rect = svg.getBoundingClientRect();
                    const activeXDomain = instance.options?.xAxis?.domain || xDomain;
                    const activeYDomain = instance.options?.yAxis?.domain || yDomain;
                    const x = activeXDomain[0] + (e.clientX - rect.left) / rect.width * (activeXDomain[1] - activeXDomain[0]);
                    const y = activeYDomain[1] - (e.clientY - rect.top) / rect.height * (activeYDomain[1] - activeYDomain[0]);
                    coords.textContent = `x: ${x.toFixed(2)}  y: ${y.toFixed(2)}`;
                });
                svg.addEventListener('mouseleave', () => {
                    coords.textContent = 'drag · scroll zoom';
                });
                coords.textContent = 'drag · scroll zoom';
            }
        }
        saveGrafikState();
    } catch (err) {
        showGrafikError('Gagal menggambar grafik: ' + (err.message || err));
    }
}, 160);

function initGrafik() {
    if (grafikInited) {
        renderGrafik();
        return;
    }
    grafikInited = true;
    const list = $('grafik-list');
    if (!list) return;
    list.innerHTML = '';

    const saved = loadGrafikState();
    if (saved && saved.fns && saved.fns.length) {
        saved.fns.forEach((v) => addGrafikRow(v, false));
        if (saved.xmin !== undefined && $('grafik-xmin')) $('grafik-xmin').value = saved.xmin;
        if (saved.xmax !== undefined && $('grafik-xmax')) $('grafik-xmax').value = saved.xmax;
        if (saved.ymin !== undefined && $('grafik-ymin')) $('grafik-ymin').value = saved.ymin;
        if (saved.ymax !== undefined && $('grafik-ymax')) $('grafik-ymax').value = saved.ymax;
        if (saved.grid !== undefined && $('grafik-grid')) $('grafik-grid').checked = !!saved.grid;
    }
    if (!list.children.length) {
        addGrafikRow('x^2', false);
        addGrafikRow('sin(x)', false);
    }

    ['grafik-xmin', 'grafik-xmax', 'grafik-ymin', 'grafik-ymax'].forEach((id) => {
        const el = $(id);
        if (!el) return;
        el.addEventListener('input', debounce(() => {
            if (!isZoomingPlot) {
                saveGrafikState();
                renderGrafik();
            }
        }, 220));
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveGrafikState();
                renderGrafik();
            }
        });
    });

    const gridEl = $('grafik-grid');
    if (gridEl) {
        gridEl.addEventListener('change', () => {
            saveGrafikState();
            renderGrafik();
        });
    }

    try {
        const ro = new ResizeObserver(debounce(() => {
            if (document.querySelector('.tab[data-tab="grafik"].active')) {
                renderGrafik();
            }
        }, 200));
        const canvasWrap = $('grafik-canvas-wrap');
        if (canvasWrap) ro.observe(canvasWrap);
    } catch (e) {
        window.addEventListener('resize', debounce(() => renderGrafik(), 300));
    }
    renderGrafik();
}

function resetGrafikView() {
    setGrafikRange(-10, 10, -10, 10);
}

function shareGrafik() {
    const fns = getGrafikFns();
    if (!fns.length) {
        alert('Tambah fungsi terlebih dahulu.');
        return;
    }
    const stateObj = {
        fns,
        xmin: $('grafik-xmin')?.value || '-10',
        xmax: $('grafik-xmax')?.value || '10',
        ymin: $('grafik-ymin')?.value || '-10',
        ymax: $('grafik-ymax')?.value || '10'
    };
    const hash = encodeURIComponent(JSON.stringify(stateObj));
    const url = `${location.origin}${location.pathname}#grafik=${hash}`;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => {
            const btn = document.querySelector('#form-grafik button[onclick="shareGrafik()"]');
            if (btn) {
                const old = btn.textContent;
                btn.textContent = '✓ Copied!';
                setTimeout(() => { btn.textContent = old; }, 1200);
            }
        });
    } else {
        prompt('Salin URL tautan:', url);
    }
}

function _getGrafikSvgString() {
    const wrap = $('grafik-canvas');
    if (!wrap) return null;
    const svg = wrap.querySelector('svg');
    if (!svg) return null;
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    const rectB = svg.getBoundingClientRect();
    const wAttr = clone.getAttribute('width');
    const hAttr = clone.getAttribute('height');
    const w = wAttr ? parseFloat(wAttr) : (rectB.width || wrap.parentElement?.clientWidth || 700);
    const h = hAttr ? parseFloat(hAttr) : (rectB.height || 380);
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);
    clone.setAttribute('viewBox', clone.getAttribute('viewBox') || `0 0 ${w} ${h}`);

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const bg = isDark ? '#1e293b' : '#f8f9fa';
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', w);
    rect.setAttribute('height', h);
    rect.setAttribute('fill', bg);
    clone.insertBefore(rect, clone.firstChild);

    return { str: new XMLSerializer().serializeToString(clone), svg, w, h };
}

function downloadGrafikAs(fmt) {
    const format = (fmt || 'svg').toLowerCase();
    const data = _getGrafikSvgString();
    if (!data) {
        alert('Belum ada grafik. Tambah fungsi terlebih dahulu.');
        return;
    }
    if (format === 'svg') {
        const blob = new Blob([data.str], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `calcku-grafik-${Date.now()}.svg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else if (format === 'png') {
        let svg64;
        try {
            svg64 = btoa(unescape(encodeURIComponent(data.str)));
        } catch (e) {
            const blob = new Blob([data.str], { type: 'image/svg+xml;charset=utf-8' });
            _renderSvgToPng(URL.createObjectURL(blob), data, true);
            return;
        }
        _renderSvgToPng('data:image/svg+xml;base64,' + svg64, data, false);
    }
}

function _renderSvgToPng(src, data, isBlob) {
    const img = new Image();
    img.onload = function () {
        try {
            const w = Math.round(data.w) || 800;
            const h = Math.round(data.h) || 380;
            const scale = Math.min(2, window.devicePixelRatio || 2);
            const canvas = document.createElement('canvas');
            canvas.width = w * scale;
            canvas.height = h * scale;
            const ctx = canvas.getContext('2d');
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            ctx.fillStyle = isDark ? '#1e293b' : '#f8f9fa';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            if (isBlob) URL.revokeObjectURL(src);

            if (canvas.toBlob) {
                canvas.toBlob((pngBlob) => {
                    if (!pngBlob) {
                        alert('Gagal konversi PNG');
                        return;
                    }
                    const pngUrl = URL.createObjectURL(pngBlob);
                    const a = document.createElement('a');
                    a.href = pngUrl;
                    a.download = `calcku-grafik-${Date.now()}.png`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(pngUrl), 800);
                }, 'image/png');
            } else {
                const pngUrl = canvas.toDataURL('image/png');
                const a = document.createElement('a');
                a.href = pngUrl;
                a.download = `calcku-grafik-${Date.now()}.png`;
                document.body.appendChild(a);
                a.click();
                a.remove();
            }
        } catch (err) {
            if (isBlob) URL.revokeObjectURL(src);
            alert('Gagal render PNG: ' + (err.message || err));
        }
    };
    img.onerror = function () {
        if (isBlob) URL.revokeObjectURL(src);
        alert('Gagal konversi PNG — coba download SVG.');
    };
    img.src = src;
}

// =============================================================================
// SECTION 9: MATRIX CALCULATOR ENGINE
// =============================================================================
const LS_MATRIX = 'calcku-matrix-v1';
let lastMatrixResult = null;

let matrixState = {
    order: ['A', 'B'],
    matrices: {
        'A': { name: 'A', rows: 2, cols: 2, data: [['1', '2'], ['3', '4']] },
        'B': { name: 'B', rows: 2, cols: 2, data: [['5', '6'], ['7', '8']] }
    },
    currentOp: 'tambah',
    opA: 'A',
    opB: 'B',
    scalarK: '2',
    scalarTarget: 'A'
};

function saveMatrixState() {
    try {
        localStorage.setItem(LS_MATRIX, JSON.stringify(matrixState));
    } catch (e) { }
}

function loadMatrixState() {
    try {
        const raw = localStorage.getItem(LS_MATRIX);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.order) && parsed.matrices) {
                matrixState = parsed;
            }
        }
        // Ensure no legacy matrix item in calculus history
        const h = loadH();
        if (h && h['matriks']) {
            delete h['matriks'];
            saveH(h);
        }
    } catch (e) { }
}

function initMatrixTab() {
    loadMatrixState();
    if (!matrixState.order || matrixState.order.length < 2) {
        matrixState.order = ['A', 'B'];
        matrixState.matrices = {
            'A': { name: 'A', rows: 2, cols: 2, data: [['1', '2'], ['3', '4']] },
            'B': { name: 'B', rows: 2, cols: 2, data: [['5', '6'], ['7', '8']] }
        };
    }
    renderMatrixCards();
    updateMatrixDropdowns();
    updateMatrixOpUI();
    checkMatrixCompatibility();
}

function updateMatrixCountBadge() {
    const badge = $('matrix-count-badge');
    if (badge) {
        badge.textContent = `${matrixState.order.length} Matriks`;
    }
}

function updateMatrixDropdowns() {
    const selA = $('matrix-op-a');
    const selB = $('matrix-op-b');
    const selScalar = $('matrix-scalar-target');
    if (!selA || !selB) return;

    const buildOptions = (current) => {
        return matrixState.order.map((key) => {
            const m = matrixState.matrices[key] || { rows: 2, cols: 2 };
            const isSelected = key === current ? 'selected' : '';
            return `<option value="${key}" ${isSelected}>Matriks ${key} (${m.rows}×${m.cols})</option>`;
        }).join('');
    };

    if (!matrixState.order.includes(matrixState.opA)) matrixState.opA = matrixState.order[0] || 'A';
    if (!matrixState.order.includes(matrixState.opB)) matrixState.opB = matrixState.order[1] || matrixState.order[0] || 'B';
    if (!matrixState.order.includes(matrixState.scalarTarget)) matrixState.scalarTarget = matrixState.order[0] || 'A';

    selA.innerHTML = buildOptions(matrixState.opA);
    selB.innerHTML = buildOptions(matrixState.opB);
    if (selScalar) selScalar.innerHTML = buildOptions(matrixState.scalarTarget);
}

function onMatrixOperandChange() {
    const selA = $('matrix-op-a');
    const selB = $('matrix-op-b');
    if (selA) matrixState.opA = selA.value;
    if (selB) matrixState.opB = selB.value;
    saveMatrixState();
    checkMatrixCompatibility();
}

function selectMatrixOp(op) {
    matrixState.currentOp = op;
    updateMatrixOpUI();
    saveMatrixState();
    checkMatrixCompatibility();
}

function updateMatrixOpUI() {
    const signs = { tambah: '+', kurang: '−', kali: '×', bagi: '÷' };
    document.querySelectorAll('.matrix-op-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.op === matrixState.currentOp);
    });
    const signEl = $('matrix-active-sign');
    if (signEl) signEl.textContent = signs[matrixState.currentOp] || '+';
}

function renderMatrixCards() {
    const container = $('matrix-cards-container');
    if (!container) return;
    container.innerHTML = '';

    matrixState.order.forEach((key) => {
        const mat = matrixState.matrices[key];
        if (!mat) return;

        const card = document.createElement('div');
        card.className = 'matrix-card-item';
        card.id = `matrix-card-${key}`;

        const canDelete = matrixState.order.length > 2;

        card.innerHTML = `
            <div class="matrix-card-top">
                <div class="matrix-badge-wrap">
                    <span class="matrix-name-badge badge-${key}">Matriks ${key}</span>
                    <span class="matrix-ordo-pill" id="ordo-pill-${key}">${mat.rows} × ${mat.cols}</span>
                </div>
                <div class="matrix-tools">
                    <button type="button" onclick="fillMatrixIdentity('${key}')" class="matrix-tool-btn" title="Ubah jadi matriks identitas">Identitas</button>
                    <button type="button" onclick="fillMatrixZeros('${key}')" class="matrix-tool-btn" title="Isi semua dengan angka 0">Nol</button>
                    <button type="button" onclick="fillMatrixRandom('${key}')" class="matrix-tool-btn" title="Isi angka acak">Acak</button>
                    <button type="button" onclick="clearMatrix('${key}')" class="matrix-tool-btn" title="Kosongkan sel">Bersihkan</button>
                    ${canDelete ? `<button type="button" onclick="removeMatrixVariable('${key}')" class="matrix-tool-btn danger" title="Hapus matriks ini">🗑 Hapus</button>` : ''}
                </div>
            </div>

            <div class="matrix-dim-controls">
                <div class="matrix-dim-group">
                    <span class="matrix-dim-label">Baris:</span>
                    <button type="button" class="matrix-dim-btn" onclick="changeMatrixDim('${key}', -1, 0)" title="Kurangi baris">−</button>
                    <span class="matrix-dim-val" id="dim-row-${key}">${mat.rows}</span>
                    <button type="button" class="matrix-dim-btn" onclick="changeMatrixDim('${key}', 1, 0)" title="Tambah baris">+</button>
                </div>
                <div class="matrix-dim-group">
                    <span class="matrix-dim-label">Kolom:</span>
                    <button type="button" class="matrix-dim-btn" onclick="changeMatrixDim('${key}', 0, -1)" title="Kurangi kolom">−</button>
                    <span class="matrix-dim-val" id="dim-col-${key}">${mat.cols}</span>
                    <button type="button" class="matrix-dim-btn" onclick="changeMatrixDim('${key}', 0, 1)" title="Tambah kolom">+</button>
                </div>
                <div class="matrix-quick-presets">
                    <button type="button" class="matrix-preset-chip" onclick="setMatrixDimensions('${key}', 2, 2)">2×2</button>
                    <button type="button" class="matrix-preset-chip" onclick="setMatrixDimensions('${key}', 3, 3)">3×3</button>
                    <button type="button" class="matrix-preset-chip" onclick="setMatrixDimensions('${key}', 2, 3)">2×3</button>
                    <button type="button" class="matrix-preset-chip" onclick="setMatrixDimensions('${key}', 3, 2)">3×2</button>
                    <button type="button" class="matrix-preset-chip" onclick="setMatrixDimensions('${key}', 1, 3)">1×3</button>
                    <button type="button" class="matrix-preset-chip" onclick="setMatrixDimensions('${key}', 3, 1)">3×1</button>
                </div>
            </div>

            <div class="matrix-grid-outer">
                <div class="matrix-grid-bracket">
                    <div class="matrix-grid-cells" id="matrix-grid-${key}" style="grid-template-columns: repeat(${mat.cols}, minmax(46px, 1fr));">
                    </div>
                </div>
            </div>
        `;

        container.appendChild(card);
        renderMatrixGrid(key);
    });

    updateMatrixCountBadge();
}

function renderMatrixGrid(key) {
    const mat = matrixState.matrices[key];
    const gridEl = $(`matrix-grid-${key}`);
    if (!mat || !gridEl) return;

    gridEl.style.gridTemplateColumns = `repeat(${mat.cols}, minmax(46px, 1fr))`;
    gridEl.innerHTML = '';

    for (let r = 0; r < mat.rows; r++) {
        for (let c = 0; c < mat.cols; c++) {
            const input = document.createElement('input');
            input.type = 'text';
            input.inputMode = 'decimal';
            input.setAttribute('inputmode', 'decimal');
            input.autocomplete = 'off';
            input.className = 'matrix-cell-input';
            input.dataset.matrix = key;
            input.dataset.row = r;
            input.dataset.col = c;
            input.placeholder = `${key.toLowerCase()}${r + 1}${c + 1}`;
            input.value = (mat.data && mat.data[r] && mat.data[r][c] !== undefined) ? mat.data[r][c] : '';

            // Saat sel diklik atau difokuskan: langsung blok teks (termasuk jika 0) agar langsung terganti saat mengetik
            input.addEventListener('focus', () => {
                setTimeout(() => {
                    try { input.select(); } catch (err) {}
                }, 50);
            });
            input.addEventListener('click', () => {
                if (input.value === '0') {
                    try { input.select(); } catch (err) {}
                }
            });

            // Jika isi sel adalah '0' dan user mengetik angka/simbol baru (selain desimal/pecahan), langsung hapus '0'
            input.addEventListener('beforeinput', (e) => {
                if (input.value === '0' && e.data && !['.', ',', '/'].includes(e.data)) {
                    input.value = '';
                }
            });

            input.addEventListener('input', (e) => {
                let val = e.target.value;
                // Jika diawali 0 lalu diikuti angka atau tanda minus (misal '05' atau '0-3') dan bukan desimal/pecahan
                if (/^0[0-9\-]/.test(val)) {
                    if (/^0+$/.test(val)) {
                        val = '0';
                    } else {
                        val = val.replace(/^0+(?=[1-9\-])/, '');
                    }
                    e.target.value = val;
                }
                mat.data[r][c] = val.trim();
                saveMatrixState();
            });

            input.addEventListener('keydown', (e) => handleMatrixCellKey(e, key, r, c));
            gridEl.appendChild(input);
        }
    }
}

function handleMatrixCellKey(e, key, r, c) {
    const mat = matrixState.matrices[key];
    if (!mat) return;

    let targetR = r;
    let targetC = c;

    if (e.key === 'ArrowUp') {
        e.preventDefault();
        targetR = Math.max(0, r - 1);
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        targetR = Math.min(mat.rows - 1, r + 1);
    } else if (e.key === 'ArrowLeft') {
        if (e.target.selectionStart === 0 && e.target.selectionEnd === 0) {
            e.preventDefault();
            if (c > 0) targetC = c - 1;
            else if (r > 0) {
                targetR = r - 1;
                targetC = mat.cols - 1;
            }
        }
    } else if (e.key === 'ArrowRight') {
        if (e.target.selectionStart === e.target.value.length) {
            e.preventDefault();
            if (c < mat.cols - 1) targetC = c + 1;
            else if (r < mat.rows - 1) {
                targetR = r + 1;
                targetC = 0;
            }
        }
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (c < mat.cols - 1) targetC = c + 1;
        else if (r < mat.rows - 1) {
            targetR = r + 1;
            targetC = 0;
        } else {
            hitungMatriks();
            return;
        }
    }

    if (targetR !== r || targetC !== c) {
        const nextInput = document.querySelector(`.matrix-cell-input[data-matrix="${key}"][data-row="${targetR}"][data-col="${targetC}"]`);
        if (nextInput) {
            nextInput.focus();
            nextInput.select();
        }
    }
}

function changeMatrixDim(key, dRow, dCol) {
    const mat = matrixState.matrices[key];
    if (!mat) return;
    const newRows = Math.max(1, Math.min(8, mat.rows + dRow));
    const newCols = Math.max(1, Math.min(8, mat.cols + dCol));
    setMatrixDimensions(key, newRows, newCols);
}

function setMatrixDimensions(key, newRows, newCols) {
    const mat = matrixState.matrices[key];
    if (!mat) return;

    newRows = Math.max(1, Math.min(8, parseInt(newRows, 10) || 1));
    newCols = Math.max(1, Math.min(8, parseInt(newCols, 10) || 1));

    const newData = [];
    for (let r = 0; r < newRows; r++) {
        const row = [];
        for (let c = 0; c < newCols; c++) {
            if (mat.data && mat.data[r] && mat.data[r][c] !== undefined) {
                row.push(mat.data[r][c]);
            } else {
                row.push('');
            }
        }
        newData.push(row);
    }

    mat.rows = newRows;
    mat.cols = newCols;
    mat.data = newData;

    const rowVal = $(`dim-row-${key}`);
    const colVal = $(`dim-col-${key}`);
    const ordoPill = $(`ordo-pill-${key}`);
    if (rowVal) rowVal.textContent = newRows;
    if (colVal) colVal.textContent = newCols;
    if (ordoPill) ordoPill.textContent = `${newRows} × ${newCols}`;

    renderMatrixGrid(key);
    updateMatrixDropdowns();
    saveMatrixState();
    checkMatrixCompatibility();
}

function fillMatrixIdentity(key) {
    const mat = matrixState.matrices[key];
    if (!mat) return;
    const maxDim = Math.max(mat.rows, mat.cols);
    setMatrixDimensions(key, maxDim, maxDim);
    for (let r = 0; r < maxDim; r++) {
        for (let c = 0; c < maxDim; c++) {
            mat.data[r][c] = (r === c) ? '1' : '0';
        }
    }
    renderMatrixGrid(key);
    saveMatrixState();
    checkMatrixCompatibility();
}

function fillMatrixZeros(key) {
    const mat = matrixState.matrices[key];
    if (!mat) return;
    for (let r = 0; r < mat.rows; r++) {
        for (let c = 0; c < mat.cols; c++) {
            mat.data[r][c] = '0';
        }
    }
    renderMatrixGrid(key);
    saveMatrixState();
}

function fillMatrixRandom(key) {
    const mat = matrixState.matrices[key];
    if (!mat) return;
    for (let r = 0; r < mat.rows; r++) {
        for (let c = 0; c < mat.cols; c++) {
            mat.data[r][c] = String(Math.floor(Math.random() * 15) - 5);
        }
    }
    renderMatrixGrid(key);
    saveMatrixState();
}

function clearMatrix(key) {
    const mat = matrixState.matrices[key];
    if (!mat) return;
    for (let r = 0; r < mat.rows; r++) {
        for (let c = 0; c < mat.cols; c++) {
            mat.data[r][c] = '';
        }
    }
    renderMatrixGrid(key);
    saveMatrixState();
}

function addMatrixVariable() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let nextLetter = null;
    for (let i = 0; i < alphabet.length; i++) {
        const letter = alphabet[i];
        if (!matrixState.order.includes(letter)) {
            nextLetter = letter;
            break;
        }
    }
    if (!nextLetter || matrixState.order.length >= 8) {
        alert('Maksimal 8 variabel matriks (A–H) untuk performa optimal.');
        return;
    }

    matrixState.order.push(nextLetter);
    matrixState.matrices[nextLetter] = {
        name: nextLetter,
        rows: 2,
        cols: 2,
        data: [['0', '0'], ['0', '0']]
    };

    renderMatrixCards();
    updateMatrixDropdowns();
    saveMatrixState();
    checkMatrixCompatibility();

    const newCard = $(`matrix-card-${nextLetter}`);
    if (newCard) {
        newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function removeMatrixVariable(key) {
    if (matrixState.order.length <= 2) {
        alert('Minimal harus ada 2 variabel matriks.');
        return;
    }
    matrixState.order = matrixState.order.filter((k) => k !== key);
    delete matrixState.matrices[key];

    if (matrixState.opA === key) matrixState.opA = matrixState.order[0];
    if (matrixState.opB === key) matrixState.opB = matrixState.order[1] || matrixState.order[0];
    if (matrixState.scalarTarget === key) matrixState.scalarTarget = matrixState.order[0];

    renderMatrixCards();
    updateMatrixDropdowns();
    saveMatrixState();
    checkMatrixCompatibility();
}

function autoFixDimensions(targetKey, targetRows, targetCols) {
    setMatrixDimensions(targetKey, targetRows, targetCols);
}

// Live Foolproof Matrix Assistant
function checkMatrixCompatibility() {
    const box = $('matrix-assistant');
    const title = $('assistant-title');
    const desc = $('assistant-desc');
    const icon = $('assistant-icon');
    const actionWrap = $('assistant-action-wrap');
    if (!box || !title || !desc || !icon || !actionWrap) return;

    const keyA = matrixState.opA;
    const keyB = matrixState.opB;
    const matA = matrixState.matrices[keyA];
    const matB = matrixState.matrices[keyB];
    const op = matrixState.currentOp;

    if (!matA || !matB) return;

    const rA = matA.rows;
    const cA = matA.cols;
    const rB = matB.rows;
    const cB = matB.cols;

    actionWrap.innerHTML = '';
    actionWrap.classList.add('hidden');

    if (op === 'tambah' || op === 'kurang') {
        const opName = op === 'tambah' ? 'Penjumlahan' : 'Pengurangan';
        if (rA === rB && cA === cB) {
            box.className = 'matrix-assistant-box valid';
            icon.textContent = '✓';
            title.textContent = `Ukuran Sesuai: ${rA}×${cA} & ${rB}×${cB}`;
            desc.textContent = `Kedua matriks memiliki ordo yang sama persis. Operasi ${opName.toLowerCase()} siap dihitung.`;
        } else {
            box.className = 'matrix-assistant-box warning';
            icon.textContent = '!';
            title.textContent = `Ukuran Belum Sesuai untuk ${opName}`;
            desc.textContent = `${opName} mensyaratkan kedua matriks berukuran sama persis atau tidak terdefinisi. (Saat ini Matriks ${keyA}: ${rA}×${cA}, Matriks ${keyB}: ${rB}×${cB}).`;

            actionWrap.classList.remove('hidden');
            const fixBtn = document.createElement('button');
            fixBtn.type = 'button';
            fixBtn.className = 'matrix-fix-btn';
            fixBtn.innerHTML = `👉 Samakan Matriks ${keyB} Menjadi ${rA}×${cA}`;
            fixBtn.onclick = () => autoFixDimensions(keyB, rA, cA);
            actionWrap.appendChild(fixBtn);
        }
    } else if (op === 'kali') {
        if (cA === rB) {
            box.className = 'matrix-assistant-box valid';
            icon.textContent = '✓';
            title.textContent = `Dapat Dikalikan! (Kolom ${keyA} = Baris ${keyB})`;
            desc.textContent = `Jumlah kolom Matriks ${keyA} (${cA}) sama dengan jumlah baris Matriks ${keyB} (${rB}). Hasil perkalian akan berordo ${rA} × ${cB}.`;
        } else {
            box.className = 'matrix-assistant-box warning';
            icon.textContent = '!';
            title.textContent = `Syarat Perkalian Belum Terpenuhi`;
            desc.textContent = `Perkalian ${keyA} × ${keyB} mensyaratkan Kolom Matriks ${keyA} (${cA}) = Baris Matriks ${keyB} (saat ini ${rB}) atau tidak terdefinisi.`;

            actionWrap.classList.remove('hidden');
            const fixBtn = document.createElement('button');
            fixBtn.type = 'button';
            fixBtn.className = 'matrix-fix-btn';
            fixBtn.innerHTML = `👉 Ubah Baris Matriks ${keyB} Menjadi ${cA}`;
            fixBtn.onclick = () => autoFixDimensions(keyB, cA, cB);
            actionWrap.appendChild(fixBtn);
        }
    } else if (op === 'bagi') {
        if (rB !== cB) {
            box.className = 'matrix-assistant-box warning';
            icon.textContent = '!';
            title.textContent = `Matriks Pembagi (${keyB}) Harus Persegi`;
            desc.textContent = `Pembagian ${keyA} ÷ ${keyB} dihitung sebagai ${keyA} × ${keyB}⁻¹. Matriks pembagi harus berupa matriks persegi (ordo n×n) agar memiliki invers atau tidak terdefinisi. (Saat ini ${keyB} berordo ${rB}×${cB}).`;

            actionWrap.classList.remove('hidden');
            const fixBtn = document.createElement('button');
            fixBtn.type = 'button';
            fixBtn.className = 'matrix-fix-btn';
            fixBtn.innerHTML = `👉 Ubah Matriks ${keyB} Menjadi Persegi (${rB}×${rB})`;
            fixBtn.onclick = () => autoFixDimensions(keyB, rB, rB);
            actionWrap.appendChild(fixBtn);
        } else if (cA !== rB) {
            box.className = 'matrix-assistant-box warning';
            icon.textContent = '!';
            title.textContent = `Dimensi Pengali Belum Cocok`;
            desc.textContent = `Kolom Matriks ${keyA} (${cA}) harus sama dengan ordo invers ${keyB} (${rB}) atau tidak terdefinisi.`;

            actionWrap.classList.remove('hidden');
            const fixBtn = document.createElement('button');
            fixBtn.type = 'button';
            fixBtn.className = 'matrix-fix-btn';
            fixBtn.innerHTML = `👉 Sesuaikan Kolom Matriks ${keyA} Menjadi ${rB}`;
            fixBtn.onclick = () => autoFixDimensions(keyA, rA, rB);
            actionWrap.appendChild(fixBtn);
        } else {
            box.className = 'matrix-assistant-box valid';
            icon.textContent = '✓';
            title.textContent = `Pembagian Valid (${keyA} × ${keyB}⁻¹)`;
            desc.textContent = `Matriks pembagi ${keyB} berordo persegi (${rB}×${cB}) dan dimensi pengali cocok. Siap dihitung.`;
        }
    }
}

async function hitungMatriks() {
    const btn = $('btn-matrix');
    const resultEl = $('hasil-matriks');
    const keyA = matrixState.opA;
    const keyB = matrixState.opB;
    const matA = matrixState.matrices[keyA];
    const matB = matrixState.matrices[keyB];

    if (!matA || !matB) {
        alert('Pilih matriks yang valid.');
        return;
    }

    setLoading(btn, true);
    resultEl.innerHTML = '<div class="skeleton-wrap"><div class="skeleton-line w80"></div><div class="skeleton-line w60"></div></div>';
    $('actions-matriks').classList.add('hidden');
    $('steps-matriks-wrap').classList.add('hidden');

    const payload = {
        operasi: matrixState.currentOp,
        matriks_a: { nama: keyA, data: matA.data },
        matriks_b: { nama: keyB, data: matB.data }
    };

    try {
        const res = await fetch('/api/matrix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.sukses) {
            renderMatrixSuccessResult(data);
        } else {
            renderMatrixErrorResult(data.error);
        }
    } catch (e) {
        renderMatrixErrorResult('Gagal menghubungi server. Pastikan koneksi atau server aktif.');
    } finally {
        setLoading(btn, false);
    }
}

function renderMatrixSuccessResult(data) {
    const resultEl = $('hasil-matriks');
    resultEl.innerHTML = '';
    resultEl.classList.remove('justify-center');

    lastMatrixResult = data;
    last['matriks'] = data.hasil_latex;

    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '8px';
    wrap.style.alignItems = 'center';
    wrap.style.width = '100%';

    const formulaDiv = document.createElement('div');
    formulaDiv.style.fontSize = '1.15em';
    const latexDisplay = `${data.notasi} = ${data.hasil_latex}`;
    try {
        katex.render(latexDisplay, formulaDiv, { throwOnError: false, displayMode: true });
    } catch (e) {
        formulaDiv.textContent = latexDisplay;
    }
    wrap.appendChild(formulaDiv);

    const infoPill = document.createElement('div');
    infoPill.className = 'matrix-ordo-pill';
    infoPill.style.margin = '4px auto 0';
    infoPill.textContent = `Ordo Hasil: ${data.baris} × ${data.kolom}`;
    wrap.appendChild(infoPill);

    resultEl.appendChild(wrap);

    $('actions-matriks').classList.remove('hidden');
    updateMatrixStoreMenu();
    renderMatrixSteps(data.langkah);
}

function renderMatrixErrorResult(errorMsg) {
    const resultEl = $('hasil-matriks');
    resultEl.innerHTML = `
        <div class="error-msg">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 8v4M12 16h.01"/>
            </svg>
            <span>${errorMsg}</span>
        </div>
    `;
    $('actions-matriks').classList.add('hidden');
    $('steps-matriks-wrap').classList.add('hidden');
}

function renderMatrixSteps(steps) {
    const wrap = $('steps-matriks-wrap');
    const body = $('steps-matriks-body');
    const badge = $('steps-badge-count');
    if (!wrap || !body || !steps || !steps.length) {
        if (wrap) wrap.classList.add('hidden');
        return;
    }

    if (badge) badge.textContent = `${steps.length} Langkah`;
    body.innerHTML = '';

    steps.forEach((step, idx) => {
        const item = document.createElement('div');
        item.className = 'step-item';

        const title = document.createElement('div');
        title.className = 'step-title';
        title.textContent = step.judul || `Langkah ${idx + 1}`;
        item.appendChild(title);

        if (step.teks) {
            const txt = document.createElement('div');
            txt.className = 'step-text';
            txt.textContent = step.teks;
            item.appendChild(txt);
        }

        if (step.latex) {
            const math = document.createElement('div');
            math.className = 'step-latex';
            try {
                katex.render(step.latex, math, { throwOnError: false, displayMode: true });
            } catch (e) {
                math.textContent = step.latex;
            }
            item.appendChild(math);
        }

        if (Array.isArray(step.items) && step.items.length) {
            const list = document.createElement('div');
            list.className = 'step-list';
            step.items.forEach((line) => {
                const li = document.createElement('div');
                li.className = 'step-list-item';
                try {
                    katex.render(line, li, { throwOnError: false, displayMode: false });
                } catch (e) {
                    li.textContent = line;
                }
                list.appendChild(li);
            });
            item.appendChild(list);
        }

        body.appendChild(item);
    });

    wrap.classList.remove('hidden');
}

function toggleMatrixSteps() {
    const body = $('steps-matriks-body');
    const arrow = $('steps-arrow');
    if (!body) return;
    const isHidden = body.classList.toggle('hidden');
    if (arrow) arrow.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
}

async function runUnaryMatrixOp(op) {
    const targetKey = matrixState.opA || matrixState.order[0];
    const mat = matrixState.matrices[targetKey];
    if (!mat) return;

    const btn = $('btn-matrix');
    const resultEl = $('hasil-matriks');
    setLoading(btn, true);
    resultEl.innerHTML = '<div class="skeleton-wrap"><div class="skeleton-line w80"></div><div class="skeleton-line w60"></div></div>';
    $('actions-matriks').classList.add('hidden');
    $('steps-matriks-wrap').classList.add('hidden');

    try {
        const res = await fetch('/api/matrix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                operasi: op,
                matriks_a: { nama: targetKey, data: mat.data }
            })
        });
        const data = await res.json();
        if (data.sukses) {
            renderMatrixSuccessResult(data);
        } else {
            renderMatrixErrorResult(data.error);
        }
    } catch (e) {
        renderMatrixErrorResult('Gagal menghitung operasi unary matriks.');
    } finally {
        setLoading(btn, false);
    }
}

function toggleScalarInput() {
    const wrap = $('matrix-scalar-wrap');
    if (wrap) wrap.classList.toggle('hidden');
}

async function runScalarOp() {
    const k = $('matrix-scalar-k').value.trim() || '1';
    const targetKey = $('matrix-scalar-target').value || matrixState.opA;
    const mat = matrixState.matrices[targetKey];
    if (!mat) return;

    const btn = $('btn-matrix');
    const resultEl = $('hasil-matriks');
    setLoading(btn, true);
    resultEl.innerHTML = '<div class="skeleton-wrap"><div class="skeleton-line w80"></div><div class="skeleton-line w60"></div></div>';
    $('actions-matriks').classList.add('hidden');
    $('steps-matriks-wrap').classList.add('hidden');

    try {
        const res = await fetch('/api/matrix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                operasi: 'skalar',
                skalar: k,
                matriks_a: { nama: targetKey, data: mat.data }
            })
        });
        const data = await res.json();
        if (data.sukses) {
            renderMatrixSuccessResult(data);
        } else {
            renderMatrixErrorResult(data.error);
        }
    } catch (e) {
        renderMatrixErrorResult('Gagal menghitung perkalian skalar.');
    } finally {
        setLoading(btn, false);
    }
}

function loadMatrixPreset(type) {
    if (type === 'tambah2x2') {
        matrixState.order = ['A', 'B'];
        matrixState.matrices = {
            'A': { name: 'A', rows: 2, cols: 2, data: [['1', '2'], ['3', '4']] },
            'B': { name: 'B', rows: 2, cols: 2, data: [['5', '6'], ['7', '8']] }
        };
        matrixState.currentOp = 'tambah';
        matrixState.opA = 'A';
        matrixState.opB = 'B';
    } else if (type === 'kurang2x2') {
        matrixState.order = ['A', 'B'];
        matrixState.matrices = {
            'A': { name: 'A', rows: 2, cols: 2, data: [['9', '5'], ['7', '4']] },
            'B': { name: 'B', rows: 2, cols: 2, data: [['3', '2'], ['1', '2']] }
        };
        matrixState.currentOp = 'kurang';
        matrixState.opA = 'A';
        matrixState.opB = 'B';
    } else if (type === 'kali2x3_3x2') {
        matrixState.order = ['A', 'B'];
        matrixState.matrices = {
            'A': { name: 'A', rows: 2, cols: 3, data: [['1', '2', '3'], ['4', '5', '6']] },
            'B': { name: 'B', rows: 3, cols: 2, data: [['7', '8'], ['9', '1'], ['2', '3']] }
        };
        matrixState.currentOp = 'kali';
        matrixState.opA = 'A';
        matrixState.opB = 'B';
    } else if (type === 'bagi2x2') {
        matrixState.order = ['A', 'B'];
        matrixState.matrices = {
            'A': { name: 'A', rows: 2, cols: 2, data: [['1', '2'], ['3', '4']] },
            'B': { name: 'B', rows: 2, cols: 2, data: [['2', '0'], ['1', '2']] }
        };
        matrixState.currentOp = 'bagi';
        matrixState.opA = 'A';
        matrixState.opB = 'B';
    } else if (type === 'ordo3x3') {
        matrixState.order = ['A', 'B'];
        matrixState.matrices = {
            'A': { name: 'A', rows: 3, cols: 3, data: [['1', '2', '3'], ['0', '1', '4'], ['5', '6', '0']] },
            'B': { name: 'B', rows: 3, cols: 3, data: [['2', '0', '-1'], ['1', '3', '2'], ['0', '-2', '1']] }
        };
        matrixState.currentOp = 'kali';
        matrixState.opA = 'A';
        matrixState.opB = 'B';
    }

    renderMatrixCards();
    updateMatrixDropdowns();
    updateMatrixOpUI();
    saveMatrixState();
    checkMatrixCompatibility();
    hitungMatriks();
}

function copyMatrixLatex() {
    if (!lastMatrixResult || !lastMatrixResult.hasil_latex) return;
    navigator.clipboard.writeText(lastMatrixResult.hasil_latex).then(() => {
        alert('LaTeX berhasil disalin!');
    }).catch(() => {
        prompt('Salin kode LaTeX berikut:', lastMatrixResult.hasil_latex);
    });
}

function copyMatrixPlainText() {
    if (!lastMatrixResult || !lastMatrixResult.hasil_grid) return;
    const txt = lastMatrixResult.hasil_grid.map((row) => row.join('\t')).join('\n');
    navigator.clipboard.writeText(txt).then(() => {
        alert('Tabel angka berhasil disalin!');
    }).catch(() => {
        prompt('Salin data berikut:', txt);
    });
}

function saveResultAsNewMatrix() {
    if (!lastMatrixResult || !lastMatrixResult.hasil_grid) return;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let nextLetter = null;
    for (let i = 0; i < alphabet.length; i++) {
        const letter = alphabet[i];
        if (!matrixState.order.includes(letter)) {
            nextLetter = letter;
            break;
        }
    }
    if (!nextLetter || matrixState.order.length >= 8) {
        alert('Variabel matriks penuh (maksimal 8).');
        return;
    }

    matrixState.order.push(nextLetter);
    matrixState.matrices[nextLetter] = {
        name: nextLetter,
        rows: lastMatrixResult.baris,
        cols: lastMatrixResult.kolom,
        data: JSON.parse(JSON.stringify(lastMatrixResult.hasil_grid))
    };

    renderMatrixCards();
    updateMatrixDropdowns();
    saveMatrixState();
    checkMatrixCompatibility();

    const newCard = $(`matrix-card-${nextLetter}`);
    if (newCard) newCard.scrollIntoView({ behavior: 'smooth' });
}

function updateMatrixStoreMenu() {
    const menu = $('menu-store-matrix');
    if (!menu) return;
    menu.innerHTML = matrixState.order.map((key) => {
        return `<button type="button" class="dropdown-item" onclick="copyResultToMatrix('${key}')">Ke Matriks ${key}</button>`;
    }).join('');
}

function toggleMatrixStoreMenu() {
    const menu = $('menu-store-matrix');
    if (menu) menu.classList.toggle('hidden');
}

function copyResultToMatrix(targetKey) {
    if (!lastMatrixResult || !lastMatrixResult.hasil_grid) return;
    const mat = matrixState.matrices[targetKey];
    if (!mat) return;

    setMatrixDimensions(targetKey, lastMatrixResult.baris, lastMatrixResult.kolom);
    mat.data = JSON.parse(JSON.stringify(lastMatrixResult.hasil_grid));
    renderMatrixGrid(targetKey);
    saveMatrixState();
    checkMatrixCompatibility();

    const menu = $('menu-store-matrix');
    if (menu) menu.classList.add('hidden');

    const card = $(`matrix-card-${targetKey}`);
    if (card) card.scrollIntoView({ behavior: 'smooth' });
}

// =============================================================================
// SECTION 10: ACCORDION & DOCUMENTATION GUIDES
// =============================================================================
function togglePanduan() {
    const el = $('panduan');
    const txt = $('panduan-toggle-text');
    if (!el) return;
    const isHidden = el.classList.toggle('hidden');
    if (txt) {
        txt.innerHTML = (isHidden ? 'Buka' : 'Tutup') +
            ' <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform:rotate(' +
            (isHidden ? '0' : '180') + 'deg);transition:transform 0.2s"><path d="M6 9l6 6 6-6"/></svg>';
    }
}

function toggleCardPanduan(bodyId, iconId) {
    const body = $(bodyId);
    const icon = $(iconId);
    if (!body) return;
    const isHidden = body.classList.toggle('hidden');
    if (icon) icon.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(180deg)';
    const btn = body.previousElementSibling;
    if (btn && btn.classList.contains('card-panduan-toggle')) {
        btn.classList.toggle('is-open', !isHidden);
        btn.setAttribute('aria-expanded', !isHidden);
        const badgeTxt = btn.querySelector('.card-panduan-badge-text');
        if (badgeTxt) badgeTxt.textContent = isHidden ? 'Buka' : 'Tutup';
    }
}

// =============================================================================
// SECTION 11: KEYBOARD SHORTCUTS & HERO FORMULAS ANIMATION
// =============================================================================
document.querySelectorAll('.card input').forEach((inp) => {
    inp.addEventListener('keydown', (e) => {
        if (e.target.classList.contains('matrix-cell-input')) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            const card = e.target.closest('.card');
            const btn = card && card.querySelector('.btn-primary');
            if (btn) btn.click();
        }
    });
});

if ($('limit-arah')) {
    $('limit-arah').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') hitungLimit();
    });
}

(function animateHeroFormulas() {
    const track = $('hero-formulas-track');
    if (!track) return;
    const formulas = [
        '\\frac{d}{dx} x^n = nx^{n-1}',
        '\\int x^n\\,dx = \\frac{x^{n+1}}{n+1}+C',
        '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1',
        'A \\cdot A^{-1} = I',
        '\\det(AB) = \\det(A) \\cdot \\det(B)',
        'e^{i\\pi} + 1 = 0',
        '\\frac{d}{dx} e^x = e^x',
        '\\int_0^\\infty e^{-x^2}dx = \\frac{\\sqrt{\\pi}}{2}',
        '\\frac{d}{dx} \\ln x = \\frac{1}{x}',
        '\\sum_{n=0}^{\\infty} \\frac{x^n}{n!} = e^x',
    ];
    const allFormulas = [...formulas, ...formulas];
    allFormulas.forEach((f) => {
        const span = document.createElement('span');
        span.className = 'hero-formula-item';
        try {
            katex.render(f, span, { throwOnError: false, displayMode: false });
        } catch (e) {
            span.textContent = f;
        }
        track.appendChild(span);
    });
})();

if (location.hash.includes('grafik=')) {
    setTimeout(() => {
        document.querySelector('[data-tab="grafik"]')?.click();
    }, 200);
}

// =============================================================================
// SECTION 12: GLOBAL WINDOW EXPORTS (GUARANTEE ACCESSIBILITY FOR INLINE ONCLICK)
// =============================================================================
window.updateThemeIcons = updateThemeIcons;
window.fillField = fillField;
window.fillTurunan = fillTurunan;
window.fillIntegral = fillIntegral;
window.fillLimit = fillLimit;
window.fillActive = fillActive;
window.autoFixAndFocus = autoFixAndFocus;
window.copyLatex = copyLatex;
window.toggleDownloadMenu = toggleDownloadMenu;
window.downloadPlotAs = downloadPlotAs;
window.hitungTurunan = hitungTurunan;
window.hitungIntegral = hitungIntegral;
window.hitungLimit = hitungLimit;
window.addGrafikRow = addGrafikRow;
window.addGrafikPreset = addGrafikPreset;
window.resetGrafikView = resetGrafikView;
window.setGrafikRange = setGrafikRange;
window.shareGrafik = shareGrafik;
window.downloadGrafikAs = downloadGrafikAs;
window.renderGrafik = renderGrafik;
window.toPlotExpr = toPlotExpr;
window.isValidPlotExpr = isValidPlotExpr;
window.initMatrixTab = initMatrixTab;
window.onMatrixOperandChange = onMatrixOperandChange;
window.selectMatrixOp = selectMatrixOp;
window.fillMatrixIdentity = fillMatrixIdentity;
window.fillMatrixZeros = fillMatrixZeros;
window.fillMatrixRandom = fillMatrixRandom;
window.clearMatrix = clearMatrix;
window.addMatrixVariable = addMatrixVariable;
window.removeMatrixVariable = removeMatrixVariable;
window.changeMatrixDim = changeMatrixDim;
window.setMatrixDimensions = setMatrixDimensions;
window.autoFixDimensions = autoFixDimensions;
window.hitungMatriks = hitungMatriks;
window.toggleMatrixSteps = toggleMatrixSteps;
window.runUnaryMatrixOp = runUnaryMatrixOp;
window.toggleScalarInput = toggleScalarInput;
window.runScalarOp = runScalarOp;
window.loadMatrixPreset = loadMatrixPreset;
window.copyMatrixLatex = copyMatrixLatex;
window.copyMatrixPlainText = copyMatrixPlainText;
window.saveResultAsNewMatrix = saveResultAsNewMatrix;
window.toggleMatrixStoreMenu = toggleMatrixStoreMenu;
window.copyResultToMatrix = copyResultToMatrix;
window.togglePanduan = togglePanduan;
window.toggleCardPanduan = toggleCardPanduan;
