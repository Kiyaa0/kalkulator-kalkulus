/**
 * =============================================================================
 * CalcKu — Main Client-Side Logic (Optimized, Modular & DRY)
 * =============================================================================
 * 1. Core Utilities, DOM Selectors & Shared Helpers
 * 2. Theme Manager (Dark / Light Mode)
 * 3. Tab Navigation & View Switcher
 * 4. Input Helpers, Auto-Fix & Live Syntax Hinting
 * 5. History Store (LocalStorage for Turunan, Integral, Limit)
 * 6. LaTeX & Result Renderer (KaTeX + Multi-Line Formatting)
 * 7. Calculus API Handlers (Turunan, Integral, Limit)
 * 8. Interactive Function Plotter (function-plot, analysis, table, SVG/PNG)
 * 9. Matrix Calculator Engine (Grid, Assistant, Operations, OBE, Presets)
 * 10. Accordion & Documentation Guides
 * 11. Hero Formulas Track & Keyboard Shortcuts
 * 12. Auto-Reset & Inactivity Protection
 * 13. Global Window Exports
 * =============================================================================
 */

// =============================================================================
// SECTION 1: CORE UTILITIES, DOM SELECTORS & SHARED HELPERS
// =============================================================================
const $ = (id) => document.getElementById(id);
const LS_H = 'calcku-h';
const LS_GRAFIK = 'calcku-grafik-v1';
const LS_MATRIX = 'calcku-matrix-v1';
const SKELETON_HTML = '<div class="skeleton-wrap"><div class="skeleton-line w80"></div><div class="skeleton-line w60"></div></div>';
const FIELD_MAP = {
    turunan: 'turunan-fungsi',
    integral: 'integral-fungsi',
    limit: 'limit-fungsi'
};

const last = {};
const plotSvgCache = {};
let currentAbortController = null;

/**
 * Batalkan request API aktif ke server untuk mencegah pemborosan beban server/CPU.
 */
function abortActiveRequests() {
    if (currentAbortController) {
        try {
            currentAbortController.abort();
        } catch (e) { }
        currentAbortController = null;
    }
}

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
 * Helper terpadu untuk download file (PNG, SVG, teks, blob).
 */
function triggerDownload(href, filename, revokeDelay = 0) {
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (revokeDelay > 0) {
        setTimeout(() => URL.revokeObjectURL(href), revokeDelay);
    }
}

/**
 * Helper terpadu untuk menyalin teks ke clipboard dengan UI/Alert feedback.
 */
function copyToClipboard(text, { btn, successText = '✓ Copied!', duration = 1200, alertMsg, promptMsg } = {}) {
    if (!text) return;
    const notifySuccess = () => {
        if (btn) {
            const original = btn.textContent;
            btn.textContent = successText;
            setTimeout(() => { btn.textContent = original; }, duration);
        } else if (alertMsg) {
            alert(alertMsg);
        }
    };

    const fallbackCopy = () => {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            if (ok) {
                notifySuccess();
                return;
            }
        } catch (e) { }
        if (promptMsg) prompt(promptMsg, text);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(notifySuccess).catch(fallbackCopy);
    } else {
        fallbackCopy();
    }
}

/**
 * Render ekspresi KaTeX dengan fallback aman ke textContent.
 */
function safeKatexRender(latex, element, displayMode = false) {
    if (!element) return;
    try {
        katex.render(latex, element, { throwOnError: false, displayMode });
    } catch (e) {
        element.textContent = latex;
    }
}

/**
 * Template markup error seragam dengan ikon peringatan.
 */
function getErrorHtml(msg) {
    return `
        <div class="error-msg">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 8v4M12 16h.01"/>
            </svg>
            <span>${msg}</span>
        </div>
    `;
}

const SUPERSCRIPTS_MAP = {
    '⁰': '^0', '¹': '^1', '²': '^2', '³': '^3', '⁴': '^4',
    '⁵': '^5', '⁶': '^6', '⁷': '^7', '⁸': '^8', '⁹': '^9',
    '⁻': '^-', '⁺': '^+'
};

/**
 * Auto-correct common mathematical input typos.
 */
function autoFix(str) {
    if (!str) return '';
    let s = str;
    // Hapus awalan penamaan fungsi (f(x) =, y =, dll.)
    s = s.replace(/^\s*[a-zA-Z]\s*\([a-zA-Z]\)\s*=\s*/, '');
    s = s.replace(/^\s*[yY]\s*=\s*/, '');

    // Normalisasi simbol matematika unicode
    s = s.replace(/[−–—]/g, '-').replace(/[×·•]/g, '*').replace(/÷/g, '/').replace(/[πΠ]/g, 'pi');
    s = s.replace(/\[/g, '(').replace(/\]/g, ')').replace(/\{/g, '(').replace(/\}/g, ')');

    // Superskrip angka
    for (const [sup, norm] of Object.entries(SUPERSCRIPTS_MAP)) {
        s = s.replaceAll(sup, norm);
    }
    s = s.replace(/\^(-|\+)\^(\d+)/g, '^($1$2)').replace(/\^(\d+)\^(\d+)/g, '^$1$2');

    // Simbol akar
    s = s.replace(/√\s*\(([^)]+)\)/g, 'sqrt($1)');
    s = s.replace(/√\s*([a-zA-Z0-9_]+)/g, 'sqrt($1)');
    s = s.replaceAll('√', 'sqrt');

    // Koma desimal Indonesia: 2,5 -> 2.5
    s = s.replace(/(\d+),(\d+)/g, '$1.$2');

    // Nilai mutlak: |x| -> abs(x)
    s = s.replace(/\|([^|]+)\|/g, 'abs($1)');

    // Sinonim trigonometri
    s = s.replace(/\btg\b/gi, 'tan').replace(/\bctg\b/gi, 'cot').replace(/\bcotan\b/gi, 'cot');

    // Perkalian implisit
    return s
        .replaceAll('^', '**')
        .replace(/(\d)\s*([a-zA-Z])/g, '$1*$2')
        .replace(/(\d)\s*\(/g, '$1*(')
        .replace(/([xyzt])\s*\(/gi, '$1*(')
        .replace(/\)\s*\(/g, ')*(')
        .replace(/\)\s*([a-zA-Z])/g, ')*$1')
        .replace(/\)\s*(\d)/g, ')*$1');
}

/**
 * Checks if string likely contains missing multiplication operators.
 */
function hasMissingStar(str) {
    return /(\d[a-zA-Z]|\d\(|[xyzt]\(|\)[a-zA-Z0-9(]|[²³⁴]|√|[0-9],[0-9])/.test(str);
}

/**
 * Converts a math expression to a function-plot compatible evaluator format.
 */
function toPlotExpr(str) {
    if (!str || !str.trim()) return '';
    let expr = str.trim();
    if (expr.includes('{')) {
        expr = expr.replace(/\{[^{}]*\}/g, '').trim();
    }
    if (expr.includes('=')) {
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

    // Reject incomplete trailing operators
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

    const inputEl = $(FIELD_MAP[activeTab]);
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
    const el = $(FIELD_MAP[tab]);
    if (!el) return;
    el.value = autoFix(el.value);
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

Object.entries(FIELD_MAP).forEach(([tab, id]) => bindValidationListener(id, tab));

// =============================================================================
// SECTION 5: HISTORY STORE (LOCALSTORAGE)
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
    h[tab] = h[tab].slice(0, 5);
    saveH(h);
    renderHistory(tab);
}

function renderHistory(tab) {
    const el = $('history-' + tab);
    if (!el) return;
    const items = loadH()[tab] || [];
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
            const input = $(FIELD_MAP[tab]);
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

// Inisialisasi riwayat saat halaman dimuat
(() => {
    Object.keys(FIELD_MAP).forEach(renderHistory);
    Object.values(FIELD_MAP).forEach((id) => {
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
        el.innerHTML = getErrorHtml(latex);
    } else {
        el.innerHTML = '';
        safeKatexRender(latex, el, true);
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
        safeKatexRender(latex, d, true);
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
    const btn = document.querySelector('#actions-' + tab + ' button');
    copyToClipboard(latex, { btn, successText: '✓ Copied!', duration: 1200 });
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
    const filename = `calcku-${tab}-${Date.now()}`;
    if (fmt === 'png') {
        const img = $('plot-' + tab + '-img');
        if (!img || !img.src || !img.src.includes('data:')) {
            alert('Belum ada grafik. Hitung dulu.');
            return;
        }
        triggerDownload(img.src, `${filename}.png`);
    } else if (fmt === 'svg') {
        const svg = plotSvgCache[tab];
        if (!svg) {
            alert('Belum ada grafik SVG. Hitung ulang.');
            return;
        }
        const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        triggerDownload(url, `${filename}.svg`, 1000);
    }
}

// =============================================================================
// SECTION 7: CALCULUS API HANDLERS (TURUNAN, INTEGRAL, LIMIT)
// =============================================================================
function finishCalculusSuccess(tab, fungsi, lines, data) {
    renderMultiLine('hasil-' + tab, lines);
    const latexSummary = lines.join(' \\n ');
    last[tab] = latexSummary;
    if (data.plot) showPlot(tab, data.plot);
    if (data.plot_svg) plotSvgCache[tab] = data.plot_svg;
    $('actions-' + tab)?.classList.remove('hidden');
    pushHistory(tab, fungsi, latexSummary);
}

async function calcApi({ endpoint, payload, tab, btnId, resultId, onSuccess }) {
    const btn = $(btnId);
    hidePlot(tab);
    setLoading(btn, true);

    const resultEl = $(resultId);
    if (resultEl) resultEl.innerHTML = SKELETON_HTML;

    abortActiveRequests();
    currentAbortController = new AbortController();

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: currentAbortController.signal
        });
        const data = await res.json();
        if (data.sukses) {
            onSuccess(data);
        } else {
            renderLatex(resultId, data.error, true);
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            if (resultEl && resultEl.innerHTML.includes('skeleton')) {
                resultEl.innerHTML = '';
            }
            return;
        }
        renderLatex(resultId, 'Gagal menghubungi server — cek koneksi atau server aktif', true);
    } finally {
        setLoading(btn, false);
    }
}

async function hitungTurunan() {
    const inputEl = $('turunan-fungsi');
    const fungsi = inputEl ? inputEl.value.trim() : '';
    if (!fungsi) { inputEl?.focus(); return; }

    const orde = $('turunan-orde')?.value || 1;
    const titik = $('turunan-titik')?.value.trim() || '';

    await calcApi({
        endpoint: '/api/turunan',
        payload: { fungsi, orde, titik: titik || null },
        tab: 'turunan',
        btnId: 'btn-turunan',
        resultId: 'hasil-turunan',
        onSuccess: (data) => {
            const lines = [`${data.notasi} = ${data.hasil}`];
            if (data.evaluasi) {
                lines.push(`f^{${orde}}(${data.titik}) = ${data.evaluasi}`);
            }
            finishCalculusSuccess('turunan', fungsi, lines, data);
        }
    });
}

async function hitungIntegral() {
    const inputEl = $('integral-fungsi');
    const fungsi = inputEl ? inputEl.value.trim() : '';
    if (!fungsi) { inputEl?.focus(); return; }

    const batas_bawah = $('integral-bawah')?.value.trim() || '';
    const batas_atas = $('integral-atas')?.value.trim() || '';

    await calcApi({
        endpoint: '/api/integral',
        payload: { fungsi, batas_bawah, batas_atas },
        tab: 'integral',
        btnId: 'btn-integral',
        resultId: 'hasil-integral',
        onSuccess: (data) => {
            const lines = [data.tentu ? `${data.notasi} = ${data.tentu}` : `${data.notasi} = ${data.hasil} + C`];
            finishCalculusSuccess('integral', fungsi, lines, data);
        }
    });
}

async function hitungLimit() {
    const inputEl = $('limit-fungsi');
    const fungsi = inputEl ? inputEl.value.trim() : '';
    if (!fungsi) { inputEl?.focus(); return; }

    const titik = $('limit-titik')?.value.trim() || '0';
    const arah = $('limit-arah')?.value || '+-';

    await calcApi({
        endpoint: '/api/limit',
        payload: { fungsi, titik, arah },
        tab: 'limit',
        btnId: 'btn-limit',
        resultId: 'hasil-limit',
        onSuccess: (data) => {
            finishCalculusSuccess('limit', fungsi, [`${data.notasi} = ${data.hasil}`], data);
        }
    });
}

// =============================================================================
// SECTION 8: INTERACTIVE FUNCTION PLOTTER (FUNCTION-PLOT ENGINE)
// =============================================================================
const GRAFIK_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6'];
let grafikInited = false;
let activePlotInstance = null;
let lastNaturalDomainData = null;
let derivativeOverlayFn = null;
let isDerivativeOverlayActive = false;
let currentGrafikDomain = {
    xmin: -10,
    xmax: 10,
    ymin: -10,
    ymax: 10
};

function getGrafikFns() {
    return Array.from(document.querySelectorAll('#grafik-list .grafik-input'))
        .map((i) => i.value.trim())
        .filter(Boolean);
}

function saveGrafikState() {
    try {
        const data = {
            fns: Array.from(document.querySelectorAll('#grafik-list .grafik-input')).map((i) => i.value),
            xmin: currentGrafikDomain.xmin,
            xmax: currentGrafikDomain.xmax,
            ymin: currentGrafikDomain.ymin,
            ymax: currentGrafikDomain.ymax,
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
                ['xmin', 'xmax', 'ymin', 'ymax'].forEach((k) => {
                    if (parsed[k] !== undefined) state[k] = parsed[k];
                });
            }
        }
    } catch (e) { }

    if (state) {
        // If state contains the old bug's default artifact [-6, 6] and [-3, 3], reset to standard [-10, 10]
        const isOldBugArtifact =
            Math.abs(Number(state.xmin) - (-6)) < 0.01 &&
            Math.abs(Number(state.xmax) - 6) < 0.01 &&
            Math.abs(Math.round(Number(state.ymin)) - (-3)) < 0.01 &&
            Math.abs(Math.round(Number(state.ymax)) - 3) < 0.01;

        if (isOldBugArtifact) {
            currentGrafikDomain = { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };
        } else {
            ['xmin', 'xmax', 'ymin', 'ymax'].forEach((k) => {
                if (Number.isFinite(Number(state[k]))) currentGrafikDomain[k] = Number(state[k]);
            });
        }
    }

    return state;
}

// =============================================================================
// DESMOS EQUATION & RESTRICTION PARSER ({ ... })
// =============================================================================
function evalBound(str) {
    if (!str) return NaN;
    let s = str.trim();
    // Normalize Indonesian comma decimal: 2,5 -> 2.5
    s = s.replace(/(\d+),(\d+)/g, '$1.$2');
    s = s.replace(/\\pi\b/gi, String(Math.PI));
    s = s.replace(/\bpi\b/gi, String(Math.PI));
    s = s.replace(/\be\b/gi, String(Math.E));
    s = s.replace(/(\d+)\s*([a-zA-Z]+)/g, '$1*$2');
    s = s.replace(/\bsqrt\(([^)]+)\)/g, 'Math.sqrt($1)');
    s = s.replace(/\babs\(([^)]+)\)/g, 'Math.abs($1)');
    s = s.replace(/\^/g, '**');
    try {
        const clean = s.replace(/Math\.(sqrt|abs|PI|E)/g, '');
        if (!/^[0-9\.\+\-\*\/\(\)\s]+$/.test(clean)) {
            const num = parseFloat(s);
            return isFinite(num) ? num : NaN;
        }
        const res = Function(`"use strict"; return (${s})`)();
        return typeof res === 'number' && isFinite(res) ? res : NaN;
    } catch (e) {
        const num = parseFloat(s);
        return isFinite(num) ? num : NaN;
    }
}

function normalizeDesmosLatex(raw) {
    if (!raw) return '';
    let s = raw.trim();
    // Remove leading numbering like "1. ", "1) ", "[1]"
    s = s.replace(/^\s*(?:\[\d+\]|\d+[\.\)])\s*/, '');
    // LaTeX symbols
    s = s.replace(/\\left\s*\\\{/g, '{').replace(/\\right\s*\\\}/g, '}');
    s = s.replace(/\\\{/g, '{').replace(/\\\}/g, '}');
    s = s.replace(/\\left\s*\(/g, '(').replace(/\\right\s*\)/g, ')');
    s = s.replace(/\\left\s*\[/g, '[').replace(/\\right\s*\]/g, ']');
    s = s.replace(/\\le\b|\\leq\b|\\leqslant\b|≤/g, '<=');
    s = s.replace(/\\ge\b|\\geq\b|\\geqslant\b|≥/g, '>=');
    s = s.replace(/\\neq\b|\\ne\b|≠/g, '!=');
    s = s.replace(/\\pi\b/g, 'PI');
    s = s.replace(/\\cdot|\\times/g, '*');
    s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '(($1)/($2))');
    s = s.replace(/\\sqrt\{([^{}]+)\}/g, 'sqrt($1)');
    s = s.replace(/\\(sin|cos|tan|cot|sec|csc|ln|log|exp|abs)\b/g, '$1');
    return s;
}

function parseParametricPair(str) {
    if (!str) return null;
    const s = str.trim();
    if (!s.startsWith('(') || !s.endsWith(')')) return null;

    let depth = 0;
    let commaIdx = -1;

    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '(') {
            depth++;
        } else if (ch === ')') {
            depth--;
            if (depth === 0 && i < s.length - 1) {
                return null;
            }
        } else if (ch === ',' && depth === 1) {
            if (commaIdx !== -1) {
                return null;
            }
            commaIdx = i;
        }
    }

    if (depth !== 0 || commaIdx === -1) return null;

    const xExpr = s.slice(1, commaIdx).trim();
    const yExpr = s.slice(commaIdx + 1, s.length - 1).trim();

    if (!xExpr || !yExpr) return null;
    return { xExpr, yExpr };
}

function createParametricEvaluator(expr) {
    if (!expr || !expr.trim()) return null;
    let js = expr.trim()
        .replace(/(\d+),(\d+)/g, '$1.$2')
        .replace(/\^/g, '**')
        .replace(/\bPI\b/gi, 'Math.PI')
        .replace(/\bE\b/g, 'Math.E')
        .replace(/\bln\b/gi, 'Math.log')
        .replace(/\blog\b/gi, 'Math.log')
        .replace(/\bsin\b/gi, 'Math.sin')
        .replace(/\bcos\b/gi, 'Math.cos')
        .replace(/\btan\b/gi, 'Math.tan')
        .replace(/\bcot\b/gi, '((t) => 1 / Math.tan(t))')
        .replace(/\bsec\b/gi, '((t) => 1 / Math.cos(t))')
        .replace(/\bcsc\b/gi, '((t) => 1 / Math.sin(t))')
        .replace(/\bsqrt\b/gi, 'Math.sqrt')
        .replace(/\babs\b/gi, 'Math.abs')
        .replace(/\bexp\b/gi, 'Math.exp');

    // Add implicit multiplication for numbers before letters/parens and closing parens before tokens
    js = js.replace(/(\d)\s*([a-zA-Z\(])/g, '$1*$2');
    js = js.replace(/(\))\s*([\d\([a-zA-Z])/g, '$1*$2');

    let fn;
    try {
        fn = new Function('t', `"use strict"; return (${js});`);
        const test = fn(0.5);
        if (!Number.isFinite(test)) return null;
    } catch (e) {
        return null;
    }

    return function(scope) {
        const t = (typeof scope === 'object' && scope !== null)
            ? (scope.t !== undefined ? scope.t : scope.x)
            : Number(scope);
        try {
            const val = fn(t);
            return Number.isFinite(val) ? val : NaN;
        } catch (e) {
            return NaN;
        }
    };
}

function getParametricBounds(fnX, fnY, tRange, samples = 80) {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    const [t0, t1] = tRange;
    const step = (t1 - t0) / samples;

    for (let i = 0; i <= samples; i++) {
        const t = t0 + i * step;
        const x = fnX(t);
        const y = fnY(t);
        if (Number.isFinite(x) && Number.isFinite(y)) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }

    if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
        return null;
    }
    return { minX, maxX, minY, maxY };
}

function parseDesmosEquation(raw) {
    if (!raw || !raw.trim()) return null;
    const normalized = normalizeDesmosLatex(raw);
    if (!normalized.trim()) return null;

    let xRange = [-Infinity, Infinity];
    let yRange = [-Infinity, Infinity];
    let tRange = [0, 1];
    let hasExplicitTRange = false;
    let isVerticalLine = false;
    let verticalX = null;

    let exprWithoutBraces = normalized;
    const braceRegex = /\{([^{}]+)\}/g;
    let match;
    const conditions = [];

    while ((match = braceRegex.exec(normalized)) !== null) {
        conditions.push(match[1].trim());
    }

    exprWithoutBraces = normalized.replace(braceRegex, '').trim();

    // Check if vertical line: e.g. x = 3
    const vertMatch = exprWithoutBraces.match(/^\s*x\s*=\s*([^=]+)$/i);
    if (vertMatch) {
        const rhs = vertMatch[1].trim();
        if (!/\bx\b/i.test(rhs) && !/\by\b/i.test(rhs)) {
            const val = evalBound(rhs);
            if (isFinite(val)) {
                isVerticalLine = true;
                verticalX = val;
            }
        }
    }

    // Check if 2D Parametric curve: e.g. (x(t), y(t))
    const paramPair = parseParametricPair(exprWithoutBraces);
    let isParametric = false;
    let fnX = null;
    let fnY = null;
    let parametricXExpr = '';
    let parametricYExpr = '';

    if (paramPair) {
        fnX = createParametricEvaluator(paramPair.xExpr);
        fnY = createParametricEvaluator(paramPair.yExpr);
        if (fnX && fnY) {
            isParametric = true;
            parametricXExpr = paramPair.xExpr;
            parametricYExpr = paramPair.yExpr;
        }
    }

    for (const cond of conditions) {
        // Compound inequality: val1 (<=|<|>=|>) var (<=|<|>=|>) val2
        const compMatch = cond.match(/^(.+?)\s*(<=|<|>=|>)\s*([xyt])\s*(<=|<|>=|>)\s*(.+)$/i);
        if (compMatch) {
            const val1 = evalBound(compMatch[1]);
            const variable = compMatch[3].toLowerCase();
            const val2 = evalBound(compMatch[5]);

            if (isFinite(val1) && isFinite(val2)) {
                const low = Math.min(val1, val2);
                const high = Math.max(val1, val2);
                if (variable === 'x') {
                    xRange[0] = Math.max(xRange[0], low);
                    xRange[1] = Math.min(xRange[1], high);
                } else if (variable === 'y') {
                    yRange[0] = Math.max(yRange[0], low);
                    yRange[1] = Math.min(yRange[1], high);
                } else if (variable === 't') {
                    tRange[0] = low;
                    tRange[1] = high;
                    hasExplicitTRange = true;
                }
            }
            continue;
        }

        // Single inequality: var op val
        const singleVarMatch = cond.match(/^([xyt])\s*(<=|<|>=|>|==|=)\s*(.+)$/i);
        if (singleVarMatch) {
            const variable = singleVarMatch[1].toLowerCase();
            const op = singleVarMatch[2];
            const val = evalBound(singleVarMatch[3]);

            if (isFinite(val)) {
                if (variable === 'x') {
                    if (op === '>=' || op === '>') xRange[0] = Math.max(xRange[0], val);
                    else if (op === '<=' || op === '<') xRange[1] = Math.min(xRange[1], val);
                } else if (variable === 'y') {
                    if (op === '>=' || op === '>') yRange[0] = Math.max(yRange[0], val);
                    else if (op === '<=' || op === '<') yRange[1] = Math.min(yRange[1], val);
                } else if (variable === 't') {
                    if (op === '>=' || op === '>') tRange[0] = val;
                    else if (op === '<=' || op === '<') tRange[1] = val;
                    hasExplicitTRange = true;
                }
            }
            continue;
        }

        // Single inequality: val op var
        const singleValMatch = cond.match(/^(.+?)\s*(<=|<|>=|>|==|=)\s*([xyt])$/i);
        if (singleValMatch) {
            const val = evalBound(singleValMatch[1]);
            const op = singleValMatch[2];
            const variable = singleValMatch[3].toLowerCase();

            if (isFinite(val)) {
                if (variable === 'x') {
                    if (op === '<=' || op === '<') xRange[0] = Math.max(xRange[0], val);
                    else if (op === '>=' || op === '>') xRange[1] = Math.min(xRange[1], val);
                } else if (variable === 'y') {
                    if (op === '<=' || op === '<') yRange[0] = Math.max(yRange[0], val);
                    else if (op === '>=' || op === '>') yRange[1] = Math.min(yRange[1], val);
                } else if (variable === 't') {
                    if (op === '<=' || op === '<') tRange[0] = val;
                    else if (op === '>=' || op === '>') tRange[1] = val;
                    hasExplicitTRange = true;
                }
            }
            continue;
        }
    }

    let cleanExpr = exprWithoutBraces;
    if (!isVerticalLine && !isParametric) {
        cleanExpr = cleanExpr.replace(/^\s*(?:[yY]|[a-zA-Z]\([a-zA-Z]\))\s*=\s*/, '');
    }

    return {
        raw,
        cleanExpr,
        isVerticalLine,
        verticalX,
        isParametric,
        fnX,
        fnY,
        xExpr: parametricXExpr,
        yExpr: parametricYExpr,
        tRange: [tRange[0], tRange[1]],
        hasExplicitTRange,
        xRange: [xRange[0], xRange[1]],
        yRange: [yRange[0], yRange[1]],
        hasRestriction: isFinite(xRange[0]) || isFinite(xRange[1]) || isFinite(yRange[0]) || isFinite(yRange[1]) || hasExplicitTRange
    };
}

function createSafeEvaluator(cleanExpr, xRange, yRange) {
    let jsExpr = cleanExpr
        .replace(/\^/g, '**')
        .replace(/\bPI\b/gi, 'Math.PI')
        .replace(/\bE\b/g, 'Math.E')
        .replace(/\bln\b/gi, 'Math.log')
        .replace(/\blog\b/gi, 'Math.log')
        .replace(/\bsin\b/gi, 'Math.sin')
        .replace(/\bcos\b/gi, 'Math.cos')
        .replace(/\btan\b/gi, 'Math.tan')
        .replace(/\bcot\b/gi, '((x) => 1 / Math.tan(x))')
        .replace(/\bsec\b/gi, '((x) => 1 / Math.cos(x))')
        .replace(/\bcsc\b/gi, '((x) => 1 / Math.sin(x))')
        .replace(/\bsqrt\b/gi, 'Math.sqrt')
        .replace(/\babs\b/gi, 'Math.abs')
        .replace(/\bexp\b/gi, 'Math.exp');

    let compiled;
    try {
        compiled = new Function('x', `"use strict"; return (${jsExpr});`);
        compiled(1);
    } catch (e) {
        return null;
    }

    const xMin = xRange && isFinite(xRange[0]) ? xRange[0] : -Infinity;
    const xMax = xRange && isFinite(xRange[1]) ? xRange[1] : Infinity;
    const yMin = yRange && isFinite(yRange[0]) ? yRange[0] : -Infinity;
    const yMax = yRange && isFinite(yRange[1]) ? yRange[1] : Infinity;

    return function(scope) {
        const x = scope.x;
        if (x < xMin || x > xMax) return NaN;
        try {
            const y = compiled(x);
            if (!Number.isFinite(y)) return NaN;
            if (y < yMin || y > yMax) return NaN;
            return y;
        } catch (err) {
            return NaN;
        }
    };
}

function updateGrafikRowIndices() {
    document.querySelectorAll('#grafik-list .grafik-row').forEach((row, i) => {
        const idxEl = row.querySelector('.grafik-idx');
        if (idxEl) idxEl.textContent = i + 1;
        const dot = row.querySelector('.grafik-dot');
        const color = GRAFIK_COLORS[i % GRAFIK_COLORS.length];
        if (dot) {
            dot.style.background = color;
            dot.style.setProperty('--dot-color', color);
        }
    });
}

function addGrafikRow(val = '', focus = true) {
    const list = $('grafik-list');
    if (!list) return null;
    const idx = list.children.length;
    const color = GRAFIK_COLORS[idx % GRAFIK_COLORS.length];
    const row = document.createElement('div');
    row.className = 'grafik-row';
    row.setAttribute('data-visible', 'true');
    row.innerHTML = `
        <span class="grafik-idx">${idx + 1}</span>
        <button type="button" class="grafik-dot-btn" title="Klik untuk sembunyikan/tampilkan grafik">
            <span class="grafik-dot" style="background:${color}; --dot-color:${color}"></span>
        </button>
        <input type="text" placeholder="contoh: y = x^2 {-2 <= x <= 2}, sin(x), x = 3" autocomplete="off" spellcheck="false" class="grafik-input" value="${val.replace(/"/g, '&quot;')}">
        <button type="button" class="grafik-del" title="Hapus baris" aria-label="Hapus">×</button>
    `;
    const inp = row.querySelector('input');
    const del = row.querySelector('.grafik-del');
    const dotBtn = row.querySelector('.grafik-dot-btn');

    // Desmos-style show/hide toggle
    dotBtn.addEventListener('click', () => {
        const isVis = row.getAttribute('data-visible') !== 'false';
        row.setAttribute('data-visible', isVis ? 'false' : 'true');
        dotBtn.title = isVis ? 'Klik untuk tampilkan grafik' : 'Klik untuk sembunyikan grafik';
        renderGrafik();
    });

    const debouncedRender = debounce(() => {
        saveGrafikState();
        renderGrafik();
    }, 200);

    inp.addEventListener('input', debouncedRender);

    // Multi-line paste handler on this input
    inp.addEventListener('paste', (e) => {
        handleGrafikPaste(e, inp);
    });

    inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveGrafikState();
            renderGrafik();
            // Desmos UX: Enter on the last row automatically creates and focuses next row
            const rows = Array.from(list.children);
            const isLast = rows[rows.length - 1] === row;
            if (isLast && inp.value.trim()) {
                addGrafikRow('', true);
            } else {
                const nextRow = row.nextElementSibling;
                if (nextRow && nextRow.querySelector('input')) {
                    nextRow.querySelector('input').focus();
                }
            }
        } else if (e.key === 'Backspace' && !inp.value && list.children.length > 1) {
            // Desmos UX: Backspace on empty input removes row and focuses previous
            e.preventDefault();
            const prevRow = row.previousElementSibling;
            row.remove();
            updateGrafikRowIndices();
            if (prevRow && prevRow.querySelector('input')) {
                const prevInput = prevRow.querySelector('input');
                prevInput.focus();
                prevInput.setSelectionRange(prevInput.value.length, prevInput.value.length);
            }
            saveGrafikState();
            renderGrafik();
        } else if (e.key === 'Escape') {
            inp.blur();
        }
    });

    del.addEventListener('click', () => {
        row.remove();
        updateGrafikRowIndices();
        if (!list.children.length) addGrafikRow('', true);
        saveGrafikState();
        renderGrafik();
    });

    list.appendChild(row);
    if (focus) inp.focus();
    return row;
}

function handleGrafikPaste(e, targetInput) {
    const clipData = (e.clipboardData || window.clipboardData);
    if (!clipData) return;
    const text = clipData.getData('text');
    if (!text) return;

    // Check if pasted text contains multiple lines (or multiple equations separated by semicolons)
    const lines = text
        .split(/\r?\n|;/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && !line.startsWith('//'));

    if (lines.length > 1) {
        e.preventDefault();
        e.stopPropagation();

        const list = $('grafik-list');
        if (!list) return;

        let startIdx = 0;
        if (targetInput) {
            targetInput.value = lines[0];
            startIdx = 1;
        }

        // Add remaining lines
        for (let i = startIdx; i < lines.length; i++) {
            addGrafikRow(lines[i], false);
        }

        updateGrafikRowIndices();
        saveGrafikState();
        renderGrafik();

        showGrafikToast(`✓ Berhasil menambahkan ${lines.length} persamaan dari clipboard!`);
    }
}


function clearAllGrafikRows() {
    const list = $('grafik-list');
    if (!list) return;
    if (confirm('Bersihkan semua baris grafik?')) {
        list.innerHTML = '';
        addGrafikRow('', true);
        saveGrafikState();
        renderGrafik();
        showGrafikToast('Semua baris grafik dibersihkan.');
    }
}

let toastTimeout = null;
function showGrafikToast(msg, duration = 2800) {
    const toast = $('grafik-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.add('hidden');
    }, duration);
}


function setGrafikRange(xmin, xmax, ymin, ymax) {
    if (Number.isFinite(Number(xmin)) && Number.isFinite(Number(xmax)) && Number(xmin) < Number(xmax)) {
        currentGrafikDomain.xmin = Number(xmin);
        currentGrafikDomain.xmax = Number(xmax);
    }
    if (ymin !== undefined && ymax !== undefined && Number.isFinite(Number(ymin)) && Number.isFinite(Number(ymax)) && Number(ymin) < Number(ymax)) {
        currentGrafikDomain.ymin = Number(ymin);
        currentGrafikDomain.ymax = Number(ymax);
    }
    saveGrafikState();
    renderGrafik();
}

function getValidDomains() {
    let { xmin, xmax, ymin, ymax } = currentGrafikDomain;

    if (!isFinite(xmin)) xmin = -10;
    if (!isFinite(xmax)) xmax = 10;
    if (!isFinite(ymin)) ymin = -10;
    if (!isFinite(ymax)) ymax = 10;

    if (xmin >= xmax) xmax = xmin + 2;
    if (ymin >= ymax) ymax = ymin + 2;

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

    const isTabActive = !!document.querySelector('.tab[data-tab="grafik"].active');
    if (!isTabActive && wrap.offsetParent === null) return;

    const wrapParent = $('grafik-canvas-wrap');
    const w = Math.floor(wrap.clientWidth || (wrapParent ? wrapParent.clientWidth : 0) || 600);
    if (w < 60) {
        requestAnimationFrame(() => renderGrafik());
        return;
    }

    const { xDomain, yDomain } = getValidDomains();
    const inputs = document.querySelectorAll('#grafik-list .grafik-input');
    const validData = [];
    let hasValidFns = false;

    inputs.forEach((inputEl, idx) => {
        const raw = inputEl.value.trim();
        if (!raw) {
            inputEl.style.borderColor = '';
            return;
        }

        const row = inputEl.closest('.grafik-row');
        if (row && row.getAttribute('data-visible') === 'false') {
            // Toggled off in UI by user (Desmos style)
            return;
        }

        const color = GRAFIK_COLORS[idx % GRAFIK_COLORS.length];

        // Parse Desmos syntax & restrictions
        const parsed = parseDesmosEquation(raw);
        if (!parsed) {
            inputEl.style.borderColor = 'var(--warning-border, #fde68a)';
            return;
        }

        // Handle vertical line: x = c { yLo <= y <= yHi }
        if (parsed.isVerticalLine) {
            const c = parsed.verticalX;
            let yLo = isFinite(parsed.yRange[0]) ? parsed.yRange[0] : (yDomain[0] - 5);
            let yHi = isFinite(parsed.yRange[1]) ? parsed.yRange[1] : (yDomain[1] + 5);
            if (yLo > yHi) { const t = yLo; yLo = yHi; yHi = t; }

            inputEl.style.borderColor = '';
            hasValidFns = true;
            validData.push({
                fnType: 'parametric',
                graphType: 'polyline',
                x: String(c),
                y: 't',
                range: [yLo, yHi],
                color: color,
                nSamples: 300
            });
            return;
        }

        // Handle 2D Parametric Curve: e.g. (x(t), y(t)) or \left(x(t), y(t)\right)
        if (parsed.isParametric) {
            inputEl.style.borderColor = '';
            hasValidFns = true;

            const bounds = getParametricBounds(parsed.fnX, parsed.fnY, parsed.tRange);
            if (bounds) {
                // Auto-fit viewport if default [-10, 10] or curve is located far away
                const isDefault = currentGrafikDomain.xmin === -10 && currentGrafikDomain.xmax === 10 &&
                                  currentGrafikDomain.ymin === -10 && currentGrafikDomain.ymax === 10;
                const isFar = bounds.minX > currentGrafikDomain.xmax || bounds.maxX < currentGrafikDomain.xmin ||
                              bounds.minY > currentGrafikDomain.ymax || bounds.maxY < currentGrafikDomain.ymin;
                if (isDefault || isFar) {
                    const padX = Math.max((bounds.maxX - bounds.minX) * 0.15, 2);
                    const padY = Math.max((bounds.maxY - bounds.minY) * 0.15, 2);
                    currentGrafikDomain.xmin = Number((bounds.minX - padX).toFixed(2));
                    currentGrafikDomain.xmax = Number((bounds.maxX + padX).toFixed(2));
                    currentGrafikDomain.ymin = Number((bounds.minY - padY).toFixed(2));
                    currentGrafikDomain.ymax = Number((bounds.maxY + padY).toFixed(2));
                }
            }

            validData.push({
                fnType: 'parametric',
                graphType: 'polyline',
                x: parsed.fnX,
                y: parsed.fnY,
                range: parsed.tRange,
                color: color,
                nSamples: 600
            });
            return;
        }

        // Standard Cartesian function: y = f(x)
        const clean = toPlotExpr(parsed.cleanExpr);
        if (!isValidPlotExpr(clean)) {
            inputEl.style.borderColor = 'var(--warning-border, #fde68a)';
            return;
        }

        inputEl.style.borderColor = '';
        hasValidFns = true;

        const datum = {
            color: color,
            graphType: 'polyline',
            sampler: 'builtIn',
            nSamples: 1200
        };

        const hasXRes = isFinite(parsed.xRange[0]) || isFinite(parsed.xRange[1]);
        const hasYRes = isFinite(parsed.yRange[0]) || isFinite(parsed.yRange[1]);

        if (hasXRes || hasYRes) {
            const safeFn = createSafeEvaluator(clean, parsed.xRange, parsed.yRange);
            if (safeFn) {
                datum.fn = safeFn;
            } else {
                datum.fn = clean;
            }

            if (isFinite(parsed.xRange[0]) && isFinite(parsed.xRange[1])) {
                datum.range = [parsed.xRange[0], parsed.xRange[1]];
            } else if (isFinite(parsed.xRange[0])) {
                datum.range = [parsed.xRange[0], Math.max(parsed.xRange[0] + 50, xDomain[1] + 10)];
            } else if (isFinite(parsed.xRange[1])) {
                datum.range = [Math.min(parsed.xRange[1] - 50, xDomain[0] - 10), parsed.xRange[1]];
            }
        } else {
            datum.fn = clean;
        }

        validData.push(datum);
    });

    if (isDerivativeOverlayActive && derivativeOverlayFn) {
        const cleanDeriv = toPlotExpr(derivativeOverlayFn);
        if (isValidPlotExpr(cleanDeriv)) {
            validData.push({
                fn: cleanDeriv,
                color: '#a855f7',
                graphType: 'polyline',
                sampler: 'builtIn',
                nSamples: 1200
            });
        }
    }

    if (!hasValidFns) {
        wrap.innerHTML = '';
        empty.classList.remove('hidden');
        clearGrafikError();
        return;
    }

    empty.classList.add('hidden');
    clearGrafikError();

    const withGrid = $('grafik-grid') ? $('grafik-grid').checked : true;
    const plotHeight = Math.min(420, Math.max(280, window.innerWidth < 480 ? 290 : 380));

    try {
        if (typeof functionPlot === 'undefined') {
            showGrafikError('Library grafik (function-plot) belum termuat. Cek koneksi internet Anda.');
            return;
        }

        wrap.innerHTML = '';
        wrap.style.height = `${plotHeight}px`;

        const instance = functionPlot({
            target: '#grafik-canvas',
            width: w,
            height: plotHeight,
            xDomain: xDomain,
            yDomain: yDomain,
            xAxis: { domain: xDomain },
            yAxis: { domain: yDomain },
            grid: withGrid,
            disableZoom: false,
            data: validData,
            tip: { xLine: true, yLine: true }
        });

        activePlotInstance = instance;

        try {
            // Function-plot updates axes and curves natively on every zoom/drag frame.
            // Do NOT wipe or re-render the canvas here — only record the new domain.
            instance.on('all:zoom', (xScale, yScale) => {
                const xd = xScale.domain();
                const yd = yScale.domain();
                if (xd && isFinite(xd[0]) && isFinite(xd[1])) {
                    currentGrafikDomain.xmin = Number(xd[0].toFixed(3));
                    currentGrafikDomain.xmax = Number(xd[1].toFixed(3));
                }
                if (yd && isFinite(yd[0]) && isFinite(yd[1])) {
                    currentGrafikDomain.ymin = Number(yd[0].toFixed(3));
                    currentGrafikDomain.ymax = Number(yd[1].toFixed(3));
                }
                debouncedSaveGrafikState();
            });
        } catch (e) { }

        const svg = wrap.querySelector('svg');
        if (svg) {
            svg.setAttribute('viewBox', `0 0 ${w} ${plotHeight}`);
            const coords = $('grafik-coords');
            if (coords) {
                coords.classList.remove('hidden');

                const fmt = (num, prec = 2) => {
                    if (!Number.isFinite(num)) return '0.00';
                    if (Math.abs(num) < 1e-5) num = 0;
                    return num.toFixed(prec);
                };

                let lastTipTime = 0;
                let lastTouchTime = 0;

                const getCursorCoords = (e) => {
                    if (!instance || !instance.meta || !instance.meta.xScale || !instance.meta.yScale) return null;
                    const zoomRect = svg.querySelector('rect.zoom-and-drag') || svg.querySelector('.canvas');
                    if (!zoomRect) return null;

                    const evt = (e.touches && e.touches.length > 0) ? e.touches[0] :
                                ((e.changedTouches && e.changedTouches.length > 0) ? e.changedTouches[0] : e);
                    if (!evt || evt.clientX === undefined || evt.clientY === undefined) return null;

                    let px, py;
                    try {
                        const pt = svg.createSVGPoint();
                        pt.x = evt.clientX;
                        pt.y = evt.clientY;
                        const ctm = zoomRect.getScreenCTM();
                        if (ctm) {
                            const loc = pt.matrixTransform(ctm.inverse());
                            px = loc.x;
                            py = loc.y;
                        }
                    } catch (err) { }

                    // Robust fallback using bounding rect and meta width/height
                    if (px === undefined || py === undefined) {
                        const b = zoomRect.getBoundingClientRect();
                        if (b.width > 0 && b.height > 0) {
                            px = ((evt.clientX - b.left) / b.width) * instance.meta.width;
                            py = ((evt.clientY - b.top) / b.height) * instance.meta.height;
                        } else {
                            return null;
                        }
                    }

                    const width = instance.meta.width;
                    const height = instance.meta.height;

                    if (px >= 0 && px <= width && py >= 0 && py <= height) {
                        const x = instance.meta.xScale.invert(px);
                        const y = instance.meta.yScale.invert(py);
                        if (Number.isFinite(x) && Number.isFinite(y)) {
                            return { x, y };
                        }
                    }
                    return null;
                };

                const updateCoords = (e) => {
                    // If tip was updated very recently (curve point snapped), keep snapped coordinate
                    if (Date.now() - lastTipTime < 80) return;
                    const pos = getCursorCoords(e);
                    if (pos) {
                        coords.textContent = `x: ${fmt(pos.x, 2)}  y: ${fmt(pos.y, 2)}`;
                    }
                };

                const handleTouch = (e) => {
                    lastTouchTime = Date.now();
                    const pos = getCursorCoords(e);
                    if (pos) {
                        if (instance.tip && typeof instance.tip.move === 'function') {
                            instance.tip.move(pos.x, pos.y);
                        }
                        if (Date.now() - lastTipTime >= 80) {
                            coords.textContent = `x: ${fmt(pos.x, 2)}  y: ${fmt(pos.y, 2)}`;
                        }
                    }
                };

                svg.addEventListener('mousemove', updateCoords);
                svg.addEventListener('touchmove', handleTouch, { passive: true });
                svg.addEventListener('touchstart', handleTouch, { passive: true });

                // Curve-snapped tooltip coordinates
                try {
                    instance.on('tip:update', (tx, ty) => {
                        if (Number.isFinite(tx) && Number.isFinite(ty)) {
                            lastTipTime = Date.now();
                            coords.textContent = `x: ${fmt(tx, 3)}  y: ${fmt(ty, 3)}`;
                        }
                    });
                } catch (e) { }

                // Visual drag cursor state
                const startDrag = () => { wrap.classList.add('is-dragging'); };
                const stopDrag = () => { wrap.classList.remove('is-dragging'); };
                svg.addEventListener('mousedown', startDrag);
                window.addEventListener('mouseup', stopDrag);
                svg.addEventListener('touchstart', startDrag, { passive: true });
                window.addEventListener('touchend', stopDrag, { passive: true });

                const resetLabel = () => {
                    stopDrag();
                    coords.textContent = 'drag · scroll zoom';
                };
                svg.addEventListener('mouseleave', resetLabel);
                svg.addEventListener('touchend', () => {
                    stopDrag();
                    setTimeout(() => {
                        if (Date.now() - lastTouchTime >= 1000) {
                            resetLabel();
                        }
                    }, 1200);
                });
                resetLabel();
            }
        }
        saveGrafikState();
    } catch (err) {
        console.error('RENDER ERROR FULL STACK:', err);
        showGrafikError('Gagal menggambar grafik: ' + (err.message || err));
    }
}, 160);

function zoomGrafik(factor) {
    const { xDomain, yDomain } = getValidDomains();
    const xCenter = (xDomain[0] + xDomain[1]) / 2;
    const yCenter = (yDomain[0] + yDomain[1]) / 2;
    const xHalf = ((xDomain[1] - xDomain[0]) / 2) * factor;
    const yHalf = ((yDomain[1] - yDomain[0]) / 2) * factor;
    setGrafikRange(
        Number((xCenter - xHalf).toFixed(3)),
        Number((xCenter + xHalf).toFixed(3)),
        Number((yCenter - yHalf).toFixed(3)),
        Number((yCenter + yHalf).toFixed(3))
    );
}

function getActiveGrafikFn() {
    const inputs = Array.from(document.querySelectorAll('#grafik-list .grafik-input'));
    const focused = document.activeElement;
    if (focused && focused.classList && focused.classList.contains('grafik-input') && focused.value.trim()) {
        return focused.value.trim();
    }
    const found = inputs.find((i) => i.value.trim());
    return found ? found.value.trim() : '';
}

async function analyzeActiveGrafik() {
    const rawVal = getActiveGrafikFn();
    if (!rawVal) {
        showGrafikError('Masukkan fungsi terlebih dahulu pada kotak fungsi.');
        return;
    }

    const parsed = parseDesmosEquation(rawVal);
    if (parsed && parsed.isParametric) {
        card.classList.remove('hidden');
        loading.classList.add('hidden');
        clearGrafikError();
        const bounds = getParametricBounds(parsed.fnX, parsed.fnY, parsed.tRange);
        const p0 = { x: parsed.fnX(parsed.tRange[0]), y: parsed.fnY(parsed.tRange[0]) };
        const p1 = { x: parsed.fnX(parsed.tRange[1]), y: parsed.fnY(parsed.tRange[1]) };

        body.innerHTML = `
            <div class="grafik-domain-box" style="margin-bottom:10px; border-left:3px solid var(--accent)">
                <div class="grafik-domain-label" style="color:var(--accent)">Kurva Parametrik 2D: (x(t), y(t))</div>
                <div style="font-family:'JetBrains Mono',monospace; font-size:12px; margin-top:4px; color:var(--text); word-break:break-all">
                    ${parsed.raw}
                </div>
            </div>
            <div class="grafik-features-grid">
                <div class="grafik-feature-card">
                    <div class="grafik-feature-title">Parameter t</div>
                    <div class="grafik-feature-val" style="font-size:13px">[${parsed.tRange[0]}, ${parsed.tRange[1]}]</div>
                </div>
                <div class="grafik-feature-card">
                    <div class="grafik-feature-title">Titik Awal (t=${parsed.tRange[0]})</div>
                    <div class="grafik-feature-val" style="font-size:12px">(${p0.x.toFixed(2)}, ${p0.y.toFixed(2)})</div>
                </div>
                <div class="grafik-feature-card">
                    <div class="grafik-feature-title">Titik Akhir (t=${parsed.tRange[1]})</div>
                    <div class="grafik-feature-val" style="font-size:12px">(${p1.x.toFixed(2)}, ${p1.y.toFixed(2)})</div>
                </div>
                <div class="grafik-feature-card">
                    <div class="grafik-feature-title">Rentang X &amp; Y</div>
                    <div class="grafik-feature-val" style="font-size:11px">${bounds ? `X: [${bounds.minX.toFixed(1)}, ${bounds.maxX.toFixed(1)}]<br>Y: [${bounds.minY.toFixed(1)}, ${bounds.maxY.toFixed(1)}]` : '-'}</div>
                </div>
            </div>
        `;
        return;
    }

    const targetVal = parsed ? (parsed.isVerticalLine ? `x = ${parsed.verticalX}` : parsed.cleanExpr) : rawVal;

    const card = $('grafik-analysis-card');
    const loading = $('grafik-analysis-loading');
    const body = $('grafik-analysis-body');
    if (!card || !loading || !body) return;

    card.classList.remove('hidden');
    loading.classList.remove('hidden');
    body.innerHTML = '';
    clearGrafikError();

    try {
        const res = await fetch('/api/natural-domain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fungsi: targetVal })
        });
        const data = await res.json();
        loading.classList.add('hidden');

        if (!data.sukses) {
            body.innerHTML = `<div class="grafik-error" style="margin-top:0">${data.error || 'Gagal menganalisis fungsi'}</div>`;
            return;
        }

        lastNaturalDomainData = data;
        derivativeOverlayFn = data.turunan_str || null;
        renderNaturalDomainAnalysis(data, parsed);
    } catch (err) {
        loading.classList.add('hidden');
        body.innerHTML = `<div class="grafik-error" style="margin-top:0">Terjadi kesalahan: ${err.message || err}</div>`;
    }
}

function renderNaturalDomainAnalysis(data, parsed) {
    const body = $('grafik-analysis-body');
    if (!body) return;

    let html = '';
    if (parsed && parsed.hasRestriction) {
        html += `
            <div class="grafik-domain-box" style="margin-bottom:10px; border-left:3px solid var(--accent)">
                <div class="grafik-domain-label" style="color:var(--accent)">Batasan Spesifik Pengguna (Gaya Desmos)</div>
                <div style="font-family:'JetBrains Mono',monospace; font-size:13px; font-weight:600; margin-top:3px; color:var(--text)">
                    ${parsed.raw}
                </div>
            </div>
        `;
    }

    html += `
        <div class="grafik-domain-box">
            <div class="grafik-domain-label">Daerah Asal Alami (Natural Domain $D_f$)</div>
            <div class="grafik-domain-val" id="g-domain-math"></div>
            ${data.domain_himpunan ? `<div class="grafik-domain-sub" id="g-domain-set"></div>` : ''}
        </div>
    `;

    if (data.syarat && data.syarat.length) {
        html += `
            <div class="grafik-syarat-box">
                <div class="grafik-syarat-title">Syarat-syarat Pembatas Definisi:</div>
                <div class="grafik-syarat-list">
                    ${data.syarat.map((s, idx) => `
                        <div style="margin-bottom:6px">
                            <strong>${idx + 1}. ${s.jenis}:</strong>
                            <div class="g-syarat-math" style="margin-top:2px" data-math="${s.teks.replace(/"/g, '&quot;')}"></div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    } else {
        html += `
            <div class="grafik-syarat-box">
                <div class="grafik-syarat-title">Tidak Ada Batasan Aljabar:</div>
                <div style="font-size:12px; color:var(--text-muted)">
                    Fungsi polinomial/kontinu ini terdefinisi pada seluruh garis bilangan riil tanpa pembagian dengan nol atau akar bilangan negatif.
                </div>
            </div>
        `;
    }

    html += `
        <div class="grafik-features-grid">
            <div class="grafik-feature-card">
                <div class="grafik-feature-title">Titik Potong X (Akar)</div>
                <div class="grafik-feature-val" id="g-feat-roots"></div>
            </div>
            <div class="grafik-feature-card">
                <div class="grafik-feature-title">Titik Potong Y (f(0))</div>
                <div class="grafik-feature-val" id="g-feat-yint"></div>
            </div>
            <div class="grafik-feature-card">
                <div class="grafik-feature-title">Asimtot Tegak</div>
                <div class="grafik-feature-val" id="g-feat-vasymp"></div>
            </div>
            <div class="grafik-feature-card">
                <div class="grafik-feature-title">Asimtot Datar</div>
                <div class="grafik-feature-val" id="g-feat-hasymp"></div>
            </div>
            <div class="grafik-feature-card">
                <div class="grafik-feature-title">Titik Stasioner (f'(x)=0)</div>
                <div class="grafik-feature-val" id="g-feat-crit"></div>
            </div>
            <div class="grafik-feature-card">
                <div class="grafik-feature-title">Simetri Fungsi</div>
                <div class="grafik-feature-val" id="g-feat-sym" style="font-size:11px"></div>
            </div>
            ${data.asimtot_miring ? `
            <div class="grafik-feature-card">
                <div class="grafik-feature-title">Asimtot Miring</div>
                <div class="grafik-feature-val" id="g-feat-slant"></div>
            </div>
            ` : ''}
        </div>
    `;

    const derivActive = isDerivativeOverlayActive ? 'active' : '';
    const derivBtnLabel = isDerivativeOverlayActive ? 'Kurva Aktif di Grafik' : 'Tampilkan Kurva di Grafik';

    html += `
        <div class="grafik-deriv-card">
            <div class="grafik-deriv-header">
                <div class="grafik-deriv-title">
                    <span>Turunan Pertama: <strong style="color:var(--accent)">f'(x)</strong></span>
                </div>
                <button type="button" onclick="toggleDerivativeFromAnalysis()" class="grafik-deriv-plot-btn ${derivActive}" id="btn-plot-deriv-card" title="Tampilkan atau sembunyikan grafik turunan f'(x)">
                    <span id="btn-plot-deriv-label">${derivBtnLabel}</span>
                </button>
            </div>
            <div class="grafik-deriv-math-wrap">
                <div id="g-feat-deriv" class="grafik-deriv-math"></div>
            </div>
        </div>

        <div style="margin-top:14px; padding-top:12px; border-top:1px solid var(--border)">
            <button type="button" onclick="openValuesTableDirect()" class="btn-secondary" style="width:100%; display:flex; align-items:center; justify-content:center; gap:6px; font-weight:600">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="3" y1="9" x2="21" y2="9"></line>
                    <line x1="3" y1="15" x2="21" y2="15"></line>
                    <line x1="9" y1="3" x2="9" y2="21"></line>
                    <line x1="15" y1="3" x2="15" y2="21"></line>
                </svg>
                <span>Buka Tabel Nilai Evaluasi Lengkap</span>
            </button>
        </div>
    `;

    body.innerHTML = html;

    if (typeof katex !== 'undefined') {
        if (data.domain_latex) safeKatexRender(`D_f = ${data.domain_latex}`, $('g-domain-math'), true);
        if (data.domain_himpunan) safeKatexRender(`\\text{Notasi Himpunan: } ${data.domain_himpunan}`, $('g-domain-set'), false);

        document.querySelectorAll('.g-syarat-math').forEach((el) => {
            const m = el.getAttribute('data-math') || '';
            if (m.includes('$$')) {
                const parts = m.split('$$');
                el.innerHTML = parts.map((part, i) => i % 2 === 1 ? katex.renderToString(part, { throwOnError: false, displayMode: true }) : part).join('');
            } else {
                safeKatexRender(m, el, false);
            }
        });

        const rootsEl = $('g-feat-roots');
        if (rootsEl) {
            data.akar && data.akar.length ? safeKatexRender(`x \\in \\{${data.akar.join(', ')}\\}`, rootsEl, false) : (rootsEl.textContent = 'Tidak ada');
        }

        const yintEl = $('g-feat-yint');
        if (yintEl) {
            data.potong_y ? safeKatexRender(`(0, ${data.potong_y})`, yintEl, false) : (yintEl.textContent = 'Tidak ada');
        }

        const vasympEl = $('g-feat-vasymp');
        if (vasympEl) {
            data.asimtot_tegak && data.asimtot_tegak.length ? safeKatexRender(`x = ${data.asimtot_tegak.join(', ')}`, vasympEl, false) : (vasympEl.textContent = 'Tidak ada');
        }

        const hasympEl = $('g-feat-hasymp');
        if (hasympEl) {
            data.asimtot_datar && data.asimtot_datar.length ? safeKatexRender(`y = ${data.asimtot_datar.join(', ')}`, hasympEl, false) : (hasympEl.textContent = 'Tidak ada');
        }

        const critEl = $('g-feat-crit');
        if (critEl) {
            if (data.titik_stasioner && data.titik_stasioner.length) {
                safeKatexRender(data.titik_stasioner.map((p) => `(${p.x}, ${p.y})`).join(', '), critEl, false);
            } else {
                critEl.textContent = 'Tidak ada';
            }
        }

        const symEl = $('g-feat-sym');
        if (symEl) symEl.textContent = data.simetri || 'Bukan keduanya';

        const slantEl = $('g-feat-slant');
        if (slantEl && data.asimtot_miring) safeKatexRender(`y = ${data.asimtot_miring}`, slantEl, false);

        const derivEl = $('g-feat-deriv');
        if (derivEl && data.turunan_latex) safeKatexRender(`f'(x) = ${data.turunan_latex}`, derivEl, true);
    }
}

function applyDomainToGraph() {
    const rawVal = getActiveGrafikFn();
    const parsed = rawVal ? parseDesmosEquation(rawVal) : null;

    if (parsed && parsed.isParametric) {
        const bounds = getParametricBounds(parsed.fnX, parsed.fnY, parsed.tRange);
        if (bounds) {
            const padX = Math.max((bounds.maxX - bounds.minX) * 0.15, 2);
            const padY = Math.max((bounds.maxY - bounds.minY) * 0.15, 2);
            setGrafikRange(
                Number((bounds.minX - padX).toFixed(2)),
                Number((bounds.maxX + padX).toFixed(2)),
                Number((bounds.minY - padY).toFixed(2)),
                Number((bounds.maxY + padY).toFixed(2))
            );
            saveGrafikState();
            renderGrafik();

            const btn = document.querySelector('.grafik-analysis-actions button');
            if (btn) {
                const oldText = btn.textContent;
                btn.textContent = 'Diterapkan!';
                setTimeout(() => { btn.textContent = oldText; }, 1200);
            }
            return;
        }
    }

    if (!lastNaturalDomainData || !lastNaturalDomainData.rentang) {
        analyzeActiveGrafik().then(() => {
            if (lastNaturalDomainData && lastNaturalDomainData.rentang) {
                applyDomainToGraph();
            }
        });
        return;
    }
    const r = lastNaturalDomainData.rentang;
    setGrafikRange(r.xmin, r.xmax, r.ymin, r.ymax);

    const btn = document.querySelector('.grafik-analysis-actions button');
    if (btn) {
        const oldText = btn.textContent;
        btn.textContent = 'Diterapkan!';
        setTimeout(() => { btn.textContent = oldText; }, 1200);
    }
}

function toggleDerivativeOverlay(forceState) {
    const cb = $('grafik-toggle-deriv');
    if (forceState !== undefined) {
        isDerivativeOverlayActive = !!forceState;
        if (cb) cb.checked = isDerivativeOverlayActive;
    } else if (cb) {
        isDerivativeOverlayActive = cb.checked;
    } else {
        isDerivativeOverlayActive = !isDerivativeOverlayActive;
    }
    updateDerivativeCardButton();

    if (isDerivativeOverlayActive && !derivativeOverlayFn) {
        analyzeActiveGrafik().then(() => {
            renderGrafik();
            updateDerivativeCardButton();
        });
        return;
    }
    renderGrafik();
}

function toggleDerivativeFromAnalysis() {
    toggleDerivativeOverlay(!isDerivativeOverlayActive);
}

function updateDerivativeCardButton() {
    const btn = $('btn-plot-deriv-card');
    const lbl = $('btn-plot-deriv-label');
    if (!btn) return;
    btn.classList.toggle('active', isDerivativeOverlayActive);
    if (lbl) {
        lbl.textContent = isDerivativeOverlayActive ? 'Kurva Aktif di Grafik' : 'Tampilkan Kurva di Grafik';
    }
}

// Evaluasi Titik & Tabel Nilai Matematis
function evaluateMathPoint(exprStr, xVal) {
    if (!exprStr || !exprStr.trim()) {
        return { x: xVal, y: 'Tak terdefinisi', terdefinisi: false };
    }

    const parsed = parseDesmosEquation(exprStr);
    const cleanExpr = parsed ? (parsed.isVerticalLine ? null : parsed.cleanExpr) : exprStr;
    if (parsed && parsed.isVerticalLine) {
        return {
            x: xVal,
            y: (Math.abs(xVal - parsed.verticalX) < 1e-6) ? 'Semua nilai y' : 'Tak terdefinisi',
            terdefinisi: Math.abs(xVal - parsed.verticalX) < 1e-6
        };
    }

    const xMin = parsed && isFinite(parsed.xRange[0]) ? parsed.xRange[0] : -Infinity;
    const xMax = parsed && isFinite(parsed.xRange[1]) ? parsed.xRange[1] : Infinity;
    const yMin = parsed && isFinite(parsed.yRange[0]) ? parsed.yRange[0] : -Infinity;
    const yMax = parsed && isFinite(parsed.yRange[1]) ? parsed.yRange[1] : Infinity;

    if (xVal < xMin || xVal > xMax) {
        return { x: xVal, y: 'Di luar domain', terdefinisi: false };
    }

    try {
        let clean = toPlotExpr(cleanExpr);
        if (!isValidPlotExpr(clean)) {
            return { x: xVal, y: 'Format tidak valid', terdefinisi: false };
        }
        clean = clean.replaceAll('^', '**');

        const mathFuncs = [
            'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
            'sinh', 'cosh', 'tanh', 'sqrt', 'cbrt', 'exp',
            'log10', 'log', 'abs'
        ];
        mathFuncs.forEach((fn) => {
            clean = clean.replace(new RegExp(`\\b${fn}\\b`, 'g'), `Math.${fn}`);
        });
        clean = clean.replace(/\bPI\b/g, 'Math.PI');

        const evalFn = new Function('x', 'Math', `"use strict"; return (${clean});`);
        const res = evalFn(xVal, Math);

        if (typeof res !== 'number' || isNaN(res) || !isFinite(res)) {
            return { x: xVal, y: 'Tak terdefinisi', terdefinisi: false };
        }
        if (res < yMin || res > yMax) {
            return { x: xVal, y: 'Di luar batasan y', terdefinisi: false };
        }
        const rounded = Math.abs(res) < 1e-12 ? 0 : Number(res.toFixed(4));
        return { x: xVal, y: rounded, terdefinisi: true };
    } catch (e) {
        return { x: xVal, y: 'Tak terdefinisi', terdefinisi: false };
    }
}

function openValuesTableDirect() {
    const fn = getActiveGrafikFn();
    const card = $('grafik-values-card');
    if (!card) return;

    if (!fn) {
        showGrafikError('Ketik fungsi terlebih dahulu pada kolom fungsi di atas.');
        return;
    }
    clearGrafikError();

    const titleEl = $('val-table-title');
    if (titleEl) titleEl.textContent = `Tabel Nilai Evaluasi: f(x) = ${fn}`;

    const evalRes = $('val-eval-result');
    if (evalRes) evalRes.classList.add('hidden');
    const evalInp = $('val-eval-x');
    if (evalInp && !evalInp.value) evalInp.value = '2';

    generateValuesTableRange(-5, 5, 1, $('chip-tbl-5'));
    card.classList.remove('hidden');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeValuesTableCard() {
    const card = $('grafik-values-card');
    if (card) card.classList.add('hidden');
}

function toggleValuesTable() {
    const card = $('grafik-values-card');
    if (card) {
        if (card.classList.contains('hidden')) {
            openValuesTableDirect();
        } else {
            closeValuesTableCard();
        }
    }
}

function generateValuesTableRange(start, end, step, clickedBtn) {
    const fn = getActiveGrafikFn();
    const tbody = $('val-table-tbody');
    if (!tbody) return;

    if (clickedBtn) {
        document.querySelectorAll('.val-chip').forEach((b) => b.classList.remove('active'));
        clickedBtn.classList.add('active');
    }

    if (!fn) {
        tbody.innerHTML = `<tr><td colspan="3" style="color:var(--text-muted); padding:16px;">Ketik fungsi di atas untuk melihat tabel nilai.</td></tr>`;
        return;
    }

    const points = [];
    const s = Math.max(0.01, Number(step) || 1);
    let curr = Number(start);
    const maxCount = 60;
    let count = 0;

    while (curr <= end + 1e-9 && count < maxCount) {
        points.push(evaluateMathPoint(fn, Number(curr.toFixed(3))));
        curr += s;
        count++;
    }

    renderValuesTableRows(points);
}

function renderValuesTableRows(points) {
    const tbody = $('val-table-tbody');
    if (!tbody) return;
    if (!points || !points.length) {
        tbody.innerHTML = `<tr><td colspan="3" style="color:var(--text-muted); padding:16px;">Tidak ada titik evaluasi.</td></tr>`;
        return;
    }

    tbody.innerHTML = points.map((pt) => `
        <tr>
            <td style="font-weight:600">${pt.x}</td>
            <td style="${pt.terdefinisi ? 'color:var(--text); font-weight:600' : 'color:var(--error)'}">${pt.y}</td>
            <td>
                <span class="val-status-pill ${pt.terdefinisi ? 'val-status-ok' : 'val-status-err'}">
                    ${pt.terdefinisi ? 'Terdefinisi' : 'Diluar Domain'}
                </span>
            </td>
        </tr>
    `).join('');
}

function evalSinglePoint() {
    const fn = getActiveGrafikFn();
    const inp = $('val-eval-x');
    const resBox = $('val-eval-result');
    if (!inp || !resBox) return;

    if (!fn) {
        resBox.textContent = 'Masukkan fungsi terlebih dahulu pada kolom fungsi.';
        resBox.classList.remove('hidden');
        return;
    }

    const rawX = inp.value.trim();
    if (!rawX) {
        resBox.textContent = 'Masukkan nilai titik x, misal: 2 atau -1.5';
        resBox.classList.remove('hidden');
        return;
    }

    let numX = parseFloat(rawX);
    if (rawX.toLowerCase() === 'pi') numX = Math.PI;
    else if (rawX.toLowerCase() === 'e') numX = Math.E;
    else if (rawX.includes('/')) {
        const p = rawX.split('/');
        if (p.length === 2 && !isNaN(p[0]) && !isNaN(p[1]) && Number(p[1]) !== 0) {
            numX = Number(p[0]) / Number(p[1]);
        }
    }

    if (isNaN(numX)) {
        resBox.textContent = `Titik x "${rawX}" bukan angka valid.`;
        resBox.classList.remove('hidden');
        return;
    }

    const pt = evaluateMathPoint(fn, Number(numX.toFixed(4)));
    resBox.innerHTML = `<strong>Hasil Evaluasi:</strong> f(${pt.x}) = <strong style="color:${pt.terdefinisi ? 'var(--accent)' : 'var(--error)'}">${pt.y}</strong> <span class="val-status-pill ${pt.terdefinisi ? 'val-status-ok' : 'val-status-err'}" style="margin-left:6px">${pt.terdefinisi ? 'Terdefinisi' : 'Diluar Domain'}</span>`;
    resBox.classList.remove('hidden');

    const tbody = $('val-table-tbody');
    if (tbody) {
        const existingRow = tbody.querySelector('.highlight-point');
        if (existingRow) existingRow.remove();

        const newRow = document.createElement('tr');
        newRow.className = 'highlight-point';
        newRow.innerHTML = `
            <td style="font-weight:700">${pt.x} *</td>
            <td style="${pt.terdefinisi ? 'color:var(--text); font-weight:700' : 'color:var(--error)'}">${pt.y}</td>
            <td>
                <span class="val-status-pill ${pt.terdefinisi ? 'val-status-ok' : 'val-status-err'}">
                    ${pt.terdefinisi ? 'Terdefinisi' : 'Diluar Domain'}
                </span>
            </td>
        `;
        tbody.insertBefore(newRow, tbody.firstChild);
    }
}

function copyValuesTable() {
    const fn = getActiveGrafikFn();
    const tbody = $('val-table-tbody');
    const btnText = $('val-copy-btn-text');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll('tr'));
    if (!rows.length) return;

    const lines = [`Tabel Evaluasi f(x) = ${fn || ''}`, '----------------------------------', 'x\tf(x)\tStatus'];
    rows.forEach((tr) => {
        const cells = tr.querySelectorAll('td');
        if (cells.length >= 3) {
            const x = cells[0].innerText.replace('*', '').trim();
            const y = cells[1].innerText.trim();
            const st = cells[2].innerText.trim();
            lines.push(`${x}\t${y}\t${st}`);
        }
    });

    copyToClipboard(lines.join('\n'), { btn: btnText, successText: 'Tersalin!', duration: 1500 });
}

function closeGrafikAnalysis() {
    const card = $('grafik-analysis-card');
    if (card) card.classList.add('hidden');
}

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
        if (saved.grid !== undefined && $('grafik-grid')) $('grafik-grid').checked = !!saved.grid;
    }
    if (!list.children.length) {
        addGrafikRow('x^2', false);
        addGrafikRow('sin(x)', false);
    }

    $('val-eval-x')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            evalSinglePoint();
        }
    });

    $('grafik-grid')?.addEventListener('change', () => {
        saveGrafikState();
        renderGrafik();
    });

    // Delegated paste on #grafik-list container
    $('grafik-list')?.addEventListener('paste', (e) => {
        if (!e.target.classList || !e.target.classList.contains('grafik-input')) {
            handleGrafikPaste(e, null);
        }
    });

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
    currentGrafikDomain = { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };
    saveGrafikState();
    renderGrafik();
}

function shareGrafik() {
    const fns = getGrafikFns();
    if (!fns.length) {
        alert('Tambah fungsi terlebih dahulu.');
        return;
    }
    const stateObj = {
        fns,
        xmin: currentGrafikDomain.xmin,
        xmax: currentGrafikDomain.xmax,
        ymin: currentGrafikDomain.ymin,
        ymax: currentGrafikDomain.ymax
    };
    const hash = encodeURIComponent(JSON.stringify(stateObj));
    const url = `${location.origin}${location.pathname}#grafik=${hash}`;
    const btn = document.querySelector('#form-grafik button[onclick="shareGrafik()"]');
    copyToClipboard(url, { btn, successText: '✓ Copied!', duration: 1200, promptMsg: 'Salin URL tautan:' });
}

function _getGrafikSvgString() {
    const wrap = $('grafik-canvas');
    const svg = wrap?.querySelector('svg');
    if (!wrap || !svg) return null;

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
    const bg = isDark ? '#0b0f17' : '#ffffff';
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', w);
    rect.setAttribute('height', h);
    rect.setAttribute('fill', bg);
    clone.insertBefore(rect, clone.firstChild);

    // Embed standalone styles so SVG and PNG exports keep the high-visibility grid
    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(15, 23, 42, 0.14)';
    const originColor = isDark ? '#cbd5e1' : '#334155';
    const axisColor = isDark ? '#64748b' : '#64748b';
    const textColor = isDark ? '#cbd5e1' : '#475569';
    styleEl.textContent = `
        .axis path.domain { stroke: ${axisColor} !important; stroke-width: 1px !important; opacity: 0.8 !important; }
        .axis line, .axis .tick line, .grid line { stroke: ${gridColor} !important; stroke-width: 1px !important; stroke-opacity: 1 !important; opacity: 0.85 !important; }
        path.origin, .origin, .x.origin, .y.origin { stroke: ${originColor} !important; stroke-width: 1.5px !important; stroke-opacity: 1 !important; opacity: 0.95 !important; }
        .axis text, .tick text { fill: ${textColor} !important; font-family: 'JetBrains Mono', monospace !important; font-size: 11px !important; font-weight: 500 !important; }
    `;
    clone.appendChild(styleEl);

    return { str: new XMLSerializer().serializeToString(clone), svg, w, h };
}

function downloadGrafikAs(fmt) {
    const format = (fmt || 'svg').toLowerCase();
    const data = _getGrafikSvgString();
    if (!data) {
        alert('Belum ada grafik. Tambah fungsi terlebih dahulu.');
        return;
    }
    const filename = `calcku-grafik-${Date.now()}`;
    if (format === 'svg') {
        const blob = new Blob([data.str], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        triggerDownload(url, `${filename}.svg`, 1000);
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
            ctx.fillStyle = isDark ? '#0b0f17' : '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            if (isBlob) URL.revokeObjectURL(src);

            const filename = `calcku-grafik-${Date.now()}.png`;
            if (canvas.toBlob) {
                canvas.toBlob((pngBlob) => {
                    if (!pngBlob) {
                        alert('Gagal konversi PNG');
                        return;
                    }
                    const pngUrl = URL.createObjectURL(pngBlob);
                    triggerDownload(pngUrl, filename, 800);
                }, 'image/png');
            } else {
                triggerDownload(canvas.toDataURL('image/png'), filename);
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
        const h = loadH();
        if (h && h['matriks']) {
            delete h['matriks'];
            saveH(h);
        }
    } catch (e) { }
}

function initMatrixTab() {
    loadMatrixState();
    if (!matrixState.order || matrixState.order.length < 1) {
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
    if (badge) badge.textContent = `${matrixState.order.length} Matriks`;
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
    if (!matrixState.order.includes(matrixState.opB)) matrixState.opB = matrixState.order[1] || matrixState.order[0] || 'A';
    if (!matrixState.order.includes(matrixState.scalarTarget)) matrixState.scalarTarget = matrixState.order[0] || 'A';

    selA.innerHTML = buildOptions(matrixState.opA);
    selB.innerHTML = buildOptions(matrixState.opB);
    if (selScalar) selScalar.innerHTML = buildOptions(matrixState.scalarTarget);
    try {
        updateObeRowOptions();
    } catch (e) { }
}

function onMatrixOperandChange() {
    const selA = $('matrix-op-a');
    const selB = $('matrix-op-b');
    if (selA) matrixState.opA = selA.value;
    if (selB) matrixState.opB = selB.value;
    saveMatrixState();
    updateMatrixOpUI();
    checkMatrixCompatibility();
}

function onScalarTargetChange() {
    const selScalar = $('matrix-scalar-target');
    if (selScalar) matrixState.scalarTarget = selScalar.value;
    saveMatrixState();
    updateMatrixOpUI();
    checkMatrixCompatibility();
}

function selectMatrixOp(op) {
    matrixState.currentOp = op;
    updateMatrixOpUI();
    saveMatrixState();
    checkMatrixCompatibility();

    if (!['skalar', 'obe_manual'].includes(op)) {
        const matA = matrixState.matrices[matrixState.opA];
        if (matA) {
            const isSingleMatrix = ['determinan', 'invers', 'transpose', 'eselon', 'eselon_tereduksi', 'spl_augmented'].includes(op);
            if (isSingleMatrix) {
                if (['determinan', 'invers'].includes(op) && matA.rows !== matA.cols) return;
                if (op === 'spl_augmented' && matA.cols < 2) return;
                hitungMatriks();
            } else if (matrixState.order.length >= 2) {
                const matB = matrixState.matrices[matrixState.opB];
                if (matB) {
                    if ((op === 'tambah' || op === 'kurang') && (matA.rows === matB.rows && matA.cols === matB.cols)) {
                        hitungMatriks();
                    } else if (op === 'kali' && matA.cols === matB.rows) {
                        hitungMatriks();
                    } else if (op === 'augmented' && matA.rows === matB.rows) {
                        hitungMatriks();
                    }
                }
            }
        }
    }
}

function updateMatrixOpUI() {
    const op = matrixState.currentOp || 'tambah';
    const signs = { tambah: '+', kurang: '−', kali: '×', bagi: '÷', augmented: '|', spl_augmented: '|' };

    document.querySelectorAll('.matrix-op-btn, .matrix-advanced-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.op === op);
    });

    const signEl = $('matrix-active-sign');
    const binarySelector = $('matrix-binary-selector');
    const colB = $('col-matrix-op-b');
    const labelA = $('label-matrix-op-a');
    const scalarWrap = $('matrix-scalar-wrap');
    const obeWrap = $('matrix-obe-wrap');
    const btnText = $('btn-matrix-text');

    const isSingleMatrix = ['determinan', 'invers', 'transpose', 'eselon', 'eselon_tereduksi', 'spl_augmented'].includes(op);
    const isScalar = op === 'skalar';
    const isObe = op === 'obe_manual';

    if (scalarWrap) scalarWrap.classList.toggle('hidden', !isScalar);
    if (obeWrap) {
        obeWrap.classList.toggle('hidden', !isObe);
        if (isObe) {
            updateObeRowOptions();
            onObeTypeChange();
        }
    }

    if (isScalar || isObe) {
        binarySelector?.classList.add('hidden');
    } else {
        binarySelector?.classList.remove('hidden');
        if (isSingleMatrix) {
            colB?.classList.add('hidden');
            signEl?.classList.add('hidden');
            if (labelA) labelA.textContent = 'Pilih Matriks Target';
        } else {
            colB?.classList.remove('hidden');
            if (signEl) {
                signEl.classList.remove('hidden');
                signEl.textContent = signs[op] || '+';
            }
            if (labelA) labelA.textContent = 'Matriks Pertama';
        }
    }

    if (btnText) {
        const a = matrixState.opA || 'A';
        const b = matrixState.opB || 'B';
        const opLabels = {
            tambah: `Hitung Penjumlahan (${a} + ${b})`,
            kurang: `Hitung Pengurangan (${a} − ${b})`,
            kali: `Hitung Perkalian (${a} × ${b})`,
            bagi: `Hitung Pembagian (${a} × ${b}⁻¹)`,
            augmented: `Gabungkan Matriks [${a} | ${b}]`,
            determinan: `Hitung Determinan (|${a}|)`,
            invers: `Hitung Invers Matriks (${a}⁻¹)`,
            transpose: `Hitung Transpose Matriks (${a}ᵀ)`,
            skalar: `Hitung Perkalian Skalar (k · ${matrixState.scalarTarget || a})`,
            eselon: `Hitung Eselon Gauss (REF ${a})`,
            eselon_tereduksi: `Hitung Eselon Tereduksi (RREF ${a})`,
            spl_augmented: `Selesaikan SPL [${a} | b]`,
            obe_manual: `Terapkan Operasi Baris (OBE)`
        };
        btnText.textContent = opLabels[op] || 'Hitung Matriks';
    }
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

        const canDelete = matrixState.order.length > 1;

        card.innerHTML = `
            <div class="matrix-card-top">
                <div class="matrix-badge-wrap">
                    <span class="matrix-name-badge badge-${key}">Matriks ${key}</span>
                    <span class="matrix-ordo-pill" id="ordo-pill-${key}">${mat.rows} × ${mat.cols}</span>
                </div>
                <div class="matrix-tools">
                    <div class="matrix-tool-group" role="group" aria-label="Isi Cepat">
                        <span class="matrix-tool-group-label">Isi:</span>
                        <button type="button" onclick="fillMatrixZeros('${key}')" class="matrix-tool-btn" title="Isi seluruh elemen dengan angka 0">0</button>
                        <button type="button" onclick="fillMatrixIdentity('${key}')" class="matrix-tool-btn" title="Ubah menjadi matriks identitas">Identitas</button>
                        <button type="button" onclick="fillMatrixRandom('${key}')" class="matrix-tool-btn" title="Isi dengan angka acak">Acak</button>
                    </div>
                    <div class="matrix-tool-actions">
                        <button type="button" onclick="clearMatrix('${key}')" class="matrix-tool-btn subtle" title="Kosongkan seluruh sel">Kosongkan</button>
                        ${canDelete ? `<button type="button" onclick="removeMatrixVariable('${key}')" class="matrix-tool-btn danger" title="Hapus matriks ini">Hapus</button>` : ''}
                    </div>
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

            input.addEventListener('focus', () => {
                setTimeout(() => {
                    try { input.select(); } catch (err) { }
                }, 50);
            });
            input.addEventListener('click', () => {
                if (input.value === '0') {
                    try { input.select(); } catch (err) { }
                }
            });

            input.addEventListener('beforeinput', (e) => {
                if (input.value === '0' && e.data && !['.', ',', '/'].includes(e.data)) {
                    input.value = '';
                }
            });

            input.addEventListener('input', (e) => {
                let val = e.target.value;
                if (/^0[0-9\-]/.test(val)) {
                    val = /^0+$/.test(val) ? '0' : val.replace(/^0+(?=[1-9\-])/, '');
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
    setMatrixDimensions(key, mat.rows + dRow, mat.cols + dCol);
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
            row.push((mat.data && mat.data[r] && mat.data[r][c] !== undefined) ? mat.data[r][c] : '');
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

function autoFixDimensions(targetKey, targetRows, targetCols) {
    setMatrixDimensions(targetKey, targetRows, targetCols);
}

function populateMatrix(key, cellGenerator, resizeSquare = false) {
    const mat = matrixState.matrices[key];
    if (!mat) return;
    if (resizeSquare) {
        const maxDim = Math.max(mat.rows, mat.cols);
        setMatrixDimensions(key, maxDim, maxDim);
    }
    for (let r = 0; r < mat.rows; r++) {
        for (let c = 0; c < mat.cols; c++) {
            mat.data[r][c] = cellGenerator(r, c);
        }
    }
    renderMatrixGrid(key);
    saveMatrixState();
    checkMatrixCompatibility();
}

function fillMatrixIdentity(key) {
    populateMatrix(key, (r, c) => (r === c ? '1' : '0'), true);
}

function fillMatrixZeros(key) {
    populateMatrix(key, () => '0');
}

function fillMatrixRandom(key) {
    populateMatrix(key, () => String(Math.floor(Math.random() * 15) - 5));
}

function clearMatrix(key) {
    populateMatrix(key, () => '');
}

function addMatrixVariable() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let nextLetter = null;
    for (let i = 0; i < alphabet.length; i++) {
        if (!matrixState.order.includes(alphabet[i])) {
            nextLetter = alphabet[i];
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

    $(`matrix-card-${nextLetter}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function removeMatrixVariable(key) {
    if (matrixState.order.length <= 1) {
        alert('Minimal harus ada 1 variabel matriks.');
        return;
    }
    matrixState.order = matrixState.order.filter((k) => k !== key);
    delete matrixState.matrices[key];

    if (matrixState.opA === key) matrixState.opA = matrixState.order[0] || 'A';
    if (matrixState.opB === key) matrixState.opB = matrixState.order[1] || matrixState.order[0] || 'A';
    if (matrixState.scalarTarget === key) matrixState.scalarTarget = matrixState.order[0] || 'A';

    renderMatrixCards();
    updateMatrixDropdowns();
    updateMatrixOpUI();
    saveMatrixState();
    checkMatrixCompatibility();
}

function addMatrixBAuto() {
    addMatrixVariable();
    if (matrixState.order.length >= 2) {
        matrixState.opB = matrixState.order[1];
        const matA = matrixState.matrices[matrixState.opA];
        if (matA) {
            if (matrixState.currentOp === 'kali') {
                setMatrixDimensions(matrixState.opB, matA.cols, matA.rows);
            } else {
                setMatrixDimensions(matrixState.opB, matA.rows, matA.cols);
            }
        }
    }
    updateMatrixDropdowns();
    updateMatrixOpUI();
    checkMatrixCompatibility();
}

function setAssistantFixAction(actionWrap, label, onClick) {
    actionWrap.classList.remove('hidden');
    const fixBtn = document.createElement('button');
    fixBtn.type = 'button';
    fixBtn.className = 'matrix-fix-btn';
    fixBtn.textContent = label;
    fixBtn.onclick = onClick;
    actionWrap.appendChild(fixBtn);
}

function checkMatrixCompatibility() {
    const box = $('matrix-assistant');
    const title = $('assistant-title');
    const desc = $('assistant-desc');
    const icon = $('assistant-icon');
    const actionWrap = $('assistant-action-wrap');
    if (!box || !title || !desc || !icon || !actionWrap) return;

    actionWrap.innerHTML = '';
    actionWrap.classList.add('hidden');

    const op = matrixState.currentOp || 'tambah';
    const keyA = matrixState.opA || matrixState.order[0] || 'A';
    const matA = matrixState.matrices[keyA];
    if (!matA) return;

    const rA = matA.rows;
    const cA = matA.cols;
    const isSingleMatrix = ['determinan', 'invers', 'transpose', 'eselon', 'eselon_tereduksi', 'spl_augmented'].includes(op);

    if (isSingleMatrix) {
        if (op === 'determinan' || op === 'invers') {
            const opName = op === 'determinan' ? 'Determinan (|A|)' : 'Invers Matriks (A⁻¹)';
            if (rA === cA) {
                box.className = 'matrix-assistant-box valid';
                icon.textContent = '✓';
                title.textContent = `Matriks Persegi (${rA}×${cA}) Siap Dihitung`;
                desc.textContent = `Matriks ${keyA} adalah matriks bujur sangkar (persegi). Syarat perhitungan ${opName.toLowerCase()} terpenuhi.`;
            } else {
                box.className = 'matrix-assistant-box warning';
                icon.textContent = '!';
                title.textContent = `${opName} Mensyaratkan Matriks Persegi`;
                desc.textContent = `${opName} hanya dapat dihitung pada matriks persegi (jumlah baris = jumlah kolom). Saat ini Matriks ${keyA} berordo ${rA}×${cA}.`;
                setAssistantFixAction(actionWrap, `Perbaiki: Ubah Matriks ${keyA} Menjadi Persegi (${rA}×${rA})`, () => setMatrixDimensions(keyA, rA, rA));
            }
        } else if (op === 'transpose') {
            box.className = 'matrix-assistant-box valid';
            icon.textContent = '✓';
            title.textContent = `Transpose Siap Dihitung (${rA}×${cA} → ${cA}×${rA})`;
            desc.textContent = `Baris akan ditukar menjadi kolom. Matriks hasil akan berordo ${cA} × ${rA}.`;
        } else if (op === 'eselon') {
            box.className = 'matrix-assistant-box valid';
            icon.textContent = '✓';
            title.textContent = `Eliminasi Gauss (REF) Siap Dijalankan`;
            desc.textContent = `Akan dibentuk matriks eselon baris segitiga atas dengan 1 utama bertingkat beserta langkah perhitungan per elemen.`;
        } else if (op === 'eselon_tereduksi') {
            box.className = 'matrix-assistant-box valid';
            icon.textContent = '✓';
            title.textContent = `Eliminasi Gauss-Jordan (RREF) Siap Dijalankan`;
            desc.textContent = `Akan dibentuk matriks eselon baris tereduksi (RREF) di mana elemen di atas dan di bawah 1 utama bernilai 0.`;
        } else if (op === 'spl_augmented') {
            if (cA >= 2) {
                box.className = 'matrix-assistant-box valid';
                icon.textContent = '✓';
                title.textContent = `Format SPL Augmented Sesuai: ${rA} Persamaan, ${cA - 1} Variabel`;
                desc.textContent = `Kolom 1 s/d ${cA - 1} adalah koefisien variabel, dan kolom ke-${cA} adalah nilai konstanta b. Siap dianalisis.`;
            } else {
                box.className = 'matrix-assistant-box warning';
                icon.textContent = '!';
                title.textContent = `Matriks Augmented Butuh Minimal 2 Kolom`;
                desc.textContent = `SPL augmented [A|b] membutuhkan minimal 1 kolom variabel dan 1 kolom konstanta b (minimal 2 kolom). Saat ini Matriks ${keyA} hanya memiliki ${cA} kolom.`;
                setAssistantFixAction(actionWrap, `Perbaiki: Tambah Kolom Matriks ${keyA} Menjadi ${Math.max(2, rA + 1)} Kolom`, () => setMatrixDimensions(keyA, rA, Math.max(2, rA + 1)));
            }
        }
        return;
    }

    if (op === 'skalar') {
        const target = matrixState.scalarTarget || keyA;
        const matTarget = matrixState.matrices[target] || matA;
        box.className = 'matrix-assistant-box valid';
        icon.textContent = '✓';
        title.textContent = `Perkalian Skalar Siap Dihitung (k · Matriks ${target})`;
        desc.textContent = `Seluruh ${matTarget.rows * matTarget.cols} elemen pada Matriks ${target} (${matTarget.rows}×${matTarget.cols}) akan dikalikan dengan skalar k.`;
        return;
    }

    if (op === 'obe_manual') {
        box.className = 'matrix-assistant-box valid';
        icon.textContent = '✓';
        title.textContent = `Mode Tool OBE Manual Aktif`;
        desc.textContent = `Pilih operasi baris di atas (tukar, skalar, atau eliminasi penjumlahan) lalu klik "Terapkan OBE".`;
        return;
    }

    if (matrixState.order.length < 2) {
        box.className = 'matrix-assistant-box warning';
        icon.textContent = '!';
        const opNames = { tambah: 'Penjumlahan', kurang: 'Pengurangan', kali: 'Perkalian', bagi: 'Pembagian', augmented: 'Gabung Augmented' };
        const opName = opNames[op] || 'Operasi 2 matriks';
        title.textContent = `${opName} Memerlukan 2 Variabel Matriks`;
        desc.textContent = `Saat ini Anda hanya memiliki 1 variabel matriks (Matriks ${keyA}). Klik tombol di bawah untuk menambahkan Matriks B secara instan.`;
        setAssistantFixAction(actionWrap, `+ Tambah Matriks B Otomatis`, () => addMatrixBAuto());
        return;
    }

    const keyB = matrixState.opB;
    const matB = matrixState.matrices[keyB];
    if (!matB) return;

    const rB = matB.rows;
    const cB = matB.cols;

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
            desc.textContent = `${opName} mensyaratkan kedua matriks berukuran sama persis. (Saat ini Matriks ${keyA}: ${rA}×${cA}, Matriks ${keyB}: ${rB}×${cB}).`;
            setAssistantFixAction(actionWrap, `Perbaiki: Samakan Matriks ${keyB} Menjadi ${rA}×${cA}`, () => setMatrixDimensions(keyB, rA, cA));
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
            desc.textContent = `Perkalian ${keyA} × ${keyB} mensyaratkan Kolom Matriks ${keyA} (${cA}) = Baris Matriks ${keyB} (saat ini ${rB}).`;
            setAssistantFixAction(actionWrap, `Perbaiki: Ubah Baris Matriks ${keyB} Menjadi ${cA}`, () => setMatrixDimensions(keyB, cA, cB));
        }
    } else if (op === 'bagi') {
        if (rB !== cB) {
            box.className = 'matrix-assistant-box warning';
            icon.textContent = '!';
            title.textContent = `Matriks Pembagi (${keyB}) Harus Persegi`;
            desc.textContent = `Pembagian ${keyA} ÷ ${keyB} dihitung sebagai ${keyA} × ${keyB}⁻¹. Matriks pembagi harus berupa matriks persegi (ordo n×n) agar memiliki invers. (Saat ini ${keyB} berordo ${rB}×${cB}).`;
            setAssistantFixAction(actionWrap, `Perbaiki: Ubah Matriks ${keyB} Menjadi Persegi (${rB}×${rB})`, () => setMatrixDimensions(keyB, rB, rB));
        } else if (cA !== rB) {
            box.className = 'matrix-assistant-box warning';
            icon.textContent = '!';
            title.textContent = `Dimensi Pengali Belum Cocok`;
            desc.textContent = `Kolom Matriks ${keyA} (${cA}) harus sama dengan ordo invers ${keyB} (${rB}).`;
            setAssistantFixAction(actionWrap, `Perbaiki: Sesuaikan Kolom Matriks ${keyA} Menjadi ${rB}`, () => setMatrixDimensions(keyA, rA, rB));
        } else {
            box.className = 'matrix-assistant-box valid';
            icon.textContent = '✓';
            title.textContent = `Pembagian Valid (${keyA} × ${keyB}⁻¹)`;
            desc.textContent = `Matriks pembagi ${keyB} berordo persegi (${rB}×${cB}) dan dimensi pengali cocok. Siap dihitung.`;
        }
    } else if (op === 'augmented') {
        if (rA === rB) {
            box.className = 'matrix-assistant-box valid';
            icon.textContent = '✓';
            title.textContent = `Ukuran Sesuai untuk Matriks Augmented [${keyA}|${keyB}]`;
            desc.textContent = `Kedua matriks memiliki jumlah baris yang sama (${rA} baris). Hasil penggabungan berukuran ${rA} × ${cA + cB}.`;
        } else {
            box.className = 'matrix-assistant-box warning';
            icon.textContent = '!';
            title.textContent = 'Jumlah Baris Belum Sama';
            desc.textContent = `Penggabungan augmented [${keyA}|${keyB}] mensyaratkan jumlah baris sama persis. (Matriks ${keyA}: ${rA} baris, Matriks ${keyB}: ${rB} baris).`;
            setAssistantFixAction(actionWrap, `Perbaiki: Samakan Baris Matriks ${keyB} Menjadi ${rA}`, () => setMatrixDimensions(keyB, rA, cB));
        }
    }
}

/**
 * Controller API terpadu untuk semua eksekusi perhitungan matriks.
 */
async function callMatrixApi(payload, fallbackErrorMsg = 'Gagal memproses matriks.', onSuccessExtra = null) {
    const btn = $('btn-matrix');
    const resultEl = $('hasil-matriks');
    setLoading(btn, true);
    if (resultEl) resultEl.innerHTML = SKELETON_HTML;
    $('actions-matriks')?.classList.add('hidden');
    $('steps-matriks-wrap')?.classList.add('hidden');

    abortActiveRequests();
    currentAbortController = new AbortController();

    try {
        const res = await fetch('/api/matrix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: currentAbortController.signal
        });
        const data = await res.json();
        if (data.sukses) {
            if (onSuccessExtra) onSuccessExtra(data);
            renderMatrixSuccessResult(data);
        } else {
            renderMatrixErrorResult(data.error);
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            if (resultEl && resultEl.innerHTML.includes('skeleton')) {
                resultEl.innerHTML = '';
            }
            return;
        }
        renderMatrixErrorResult(fallbackErrorMsg);
    } finally {
        setLoading(btn, false);
    }
}

async function hitungMatriks() {
    const op = matrixState.currentOp || 'tambah';

    if (op === 'skalar') return runScalarOp();
    if (op === 'obe_manual') return runManualObe(false);
    if (['determinan', 'invers', 'transpose', 'eselon', 'eselon_tereduksi'].includes(op)) {
        return runUnaryMatrixOp(op);
    }
    if (op === 'spl_augmented') return runSplAugmentedOp();

    if (matrixState.order.length < 2) {
        addMatrixBAuto();
        return;
    }

    const keyA = matrixState.opA;
    const keyB = matrixState.opB;
    const matA = matrixState.matrices[keyA];
    const matB = matrixState.matrices[keyB];

    if (!matA || !matB) {
        alert('Pilih matriks yang valid.');
        return;
    }

    await callMatrixApi(
        {
            operasi: op,
            matriks_a: { nama: keyA, data: matA.data },
            matriks_b: { nama: keyB, data: matB.data }
        },
        'Gagal menghubungi server. Pastikan koneksi atau server aktif.'
    );
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
    safeKatexRender(`${data.notasi} = ${data.hasil_latex}`, formulaDiv, true);
    wrap.appendChild(formulaDiv);

    const infoPill = document.createElement('div');
    infoPill.className = 'matrix-ordo-pill';
    infoPill.style.margin = '4px auto 0';
    let pillText = `Ordo Hasil: ${data.baris} × ${data.kolom}`;
    if (data.is_augmented && data.split_col) {
        pillText += ` (Augmented: ${data.baris}×${data.split_col} | ${data.baris}×${data.kolom - data.split_col})`;
    }
    if (data.rank !== undefined) {
        pillText += ` • Rank: ${data.rank}`;
    }
    infoPill.textContent = pillText;
    wrap.appendChild(infoPill);

    if (data.spl_info) {
        const spl = data.spl_info;
        const splCard = document.createElement('div');
        splCard.className = `spl-callout-card ${spl.status}`;

        const header = document.createElement('div');
        header.className = 'spl-card-header';

        const title = document.createElement('div');
        title.className = 'spl-card-title';
        title.textContent = spl.judul || 'Analisis Sistem Persamaan Linear';

        const badge = document.createElement('span');
        badge.className = `spl-status-badge ${spl.status}`;
        badge.textContent = spl.status === 'solusi_tunggal' ? 'Solusi Tunggal (Unik)' :
            (spl.status === 'tidak_ada_solusi' ? 'Tidak Ada Solusi' : 'Tak Hingga Solusi');

        header.appendChild(title);
        header.appendChild(badge);
        splCard.appendChild(header);

        if (spl.teks) {
            const desc = document.createElement('div');
            desc.className = 'spl-card-desc';
            desc.textContent = spl.teks;
            splCard.appendChild(desc);
        }

        if (Array.isArray(spl.solusi) && spl.solusi.length) {
            const solGrid = document.createElement('div');
            solGrid.className = 'spl-solution-grid';
            spl.solusi.forEach((solStr) => {
                const chip = document.createElement('div');
                chip.className = 'spl-solution-chip';
                safeKatexRender(solStr, chip, false);
                solGrid.appendChild(chip);
            });
            splCard.appendChild(solGrid);
        }

        wrap.appendChild(splCard);
    }

    resultEl.appendChild(wrap);
    $('actions-matriks')?.classList.remove('hidden');
    updateMatrixStoreMenu();
    renderMatrixSteps(data.langkah);
}

function renderMatrixErrorResult(errorMsg) {
    const resultEl = $('hasil-matriks');
    if (resultEl) resultEl.innerHTML = getErrorHtml(errorMsg);
    $('actions-matriks')?.classList.add('hidden');
    $('steps-matriks-wrap')?.classList.add('hidden');
}

function renderMatrixSteps(steps) {
    const wrap = $('steps-matriks-wrap');
    const body = $('steps-matriks-body');
    const badge = $('steps-badge-count');
    if (!wrap || !body || !steps || !steps.length) {
        wrap?.classList.add('hidden');
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
            safeKatexRender(step.latex, math, true);
            item.appendChild(math);
        }

        if (Array.isArray(step.items) && step.items.length) {
            const list = document.createElement('div');
            list.className = 'step-list';
            step.items.forEach((line) => {
                const li = document.createElement('div');
                li.className = 'step-list-item';
                safeKatexRender(line, li, false);
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

    await callMatrixApi(
        {
            operasi: op,
            matriks_a: { nama: targetKey, data: mat.data }
        },
        'Gagal menghitung operasi unary matriks.'
    );
}

function toggleScalarInput() {
    $('matrix-scalar-wrap')?.classList.toggle('hidden');
}

async function runScalarOp() {
    const k = $('matrix-scalar-k')?.value.trim() || '1';
    const targetKey = $('matrix-scalar-target')?.value || matrixState.opA;
    const mat = matrixState.matrices[targetKey];
    if (!mat) return;

    await callMatrixApi(
        {
            operasi: 'skalar',
            skalar: k,
            matriks_a: { nama: targetKey, data: mat.data }
        },
        'Gagal menghitung perkalian skalar.'
    );
}

async function runSplAugmentedOp() {
    const targetKey = matrixState.opA || matrixState.order[0];
    const mat = matrixState.matrices[targetKey];
    if (!mat) return;

    if (mat.cols < 2) {
        alert('Matriks augmented untuk SPL membutuhkan minimal 2 kolom (minimal 1 kolom variabel dan 1 kolom konstanta b). Silakan tambah kolom matriks.');
        return;
    }

    await callMatrixApi(
        {
            operasi: 'spl_augmented',
            matriks_a: { nama: targetKey, data: mat.data },
            is_augmented: true,
            split_col: mat.cols - 1
        },
        'Gagal menyelesaikan SPL dari matriks augmented.'
    );
}

function runBinaryOpDirect(op) {
    matrixState.currentOp = op;
    updateMatrixOpUI();
    checkMatrixCompatibility();
    hitungMatriks();
}

function toggleObeManualInput() {
    const wrap = $('matrix-obe-wrap');
    if (!wrap) return;
    const isHidden = wrap.classList.toggle('hidden');
    if (!isHidden) {
        updateObeRowOptions();
        onObeTypeChange();
    }
}

function onObeTypeChange() {
    const type = $('matrix-obe-type')?.value || 'tukar';
    const fieldK = $('obe-field-k');
    const fieldRowJ = $('obe-field-row-j');
    const labelRowI = $('label-obe-row-i');

    if (type === 'tukar') {
        fieldK?.classList.add('hidden');
        fieldRowJ?.classList.remove('hidden');
        if (labelRowI) labelRowI.textContent = 'Baris Pertama (Ri)';
    } else if (type === 'skalar') {
        fieldK?.classList.remove('hidden');
        fieldRowJ?.classList.add('hidden');
        if (labelRowI) labelRowI.textContent = 'Baris yang Dikalikan (Ri)';
    } else if (type === 'tambah') {
        fieldK?.classList.remove('hidden');
        fieldRowJ?.classList.remove('hidden');
        if (labelRowI) labelRowI.textContent = 'Baris Target (Ri)';
    }
}

function updateObeRowOptions() {
    const targetSelect = $('matrix-obe-target');
    const rowISelect = $('matrix-obe-row-i');
    const rowJSelect = $('matrix-obe-row-j');
    if (!targetSelect || !rowISelect || !rowJSelect) return;

    const curTarget = targetSelect.value || matrixState.opA || matrixState.order[0];
    targetSelect.innerHTML = matrixState.order.map((key) => {
        return `<option value="${key}" ${key === curTarget ? 'selected' : ''}>Matriks ${key}</option>`;
    }).join('');

    const activeTarget = targetSelect.value || matrixState.order[0];
    const mat = matrixState.matrices[activeTarget];
    if (!mat) return;

    const curRowI = parseInt(rowISelect.value, 10) || 1;
    const curRowJ = parseInt(rowJSelect.value, 10) || (mat.rows > 1 ? 2 : 1);

    let optionsHtml = '';
    for (let r = 1; r <= mat.rows; r++) {
        optionsHtml += `<option value="${r}">Baris ke-${r} (R${r})</option>`;
    }
    rowISelect.innerHTML = optionsHtml;
    rowJSelect.innerHTML = optionsHtml;

    rowISelect.value = String(Math.min(mat.rows, curRowI));
    rowJSelect.value = String(Math.min(mat.rows, curRowJ));
}

async function runManualObe(saveBackToMatrix = false) {
    const targetKey = $('matrix-obe-target')?.value || matrixState.opA || matrixState.order[0];
    const mat = matrixState.matrices[targetKey];
    if (!mat) return;

    const obeType = $('matrix-obe-type')?.value || 'tukar';
    const rowI = parseInt($('matrix-obe-row-i')?.value, 10) || 1;
    const rowJ = parseInt($('matrix-obe-row-j')?.value, 10) || 1;
    const kVal = $('matrix-obe-k')?.value.trim() || '1';
    const isAugmented = !!$('matrix-obe-is-augmented')?.checked;

    if (obeType === 'tukar' && rowI === rowJ) {
        alert('Untuk menukar baris, pilih dua baris yang berbeda!');
        return;
    }
    if (obeType === 'tambah' && rowI === rowJ) {
        alert('Baris target dan baris sumber harus berbeda!');
        return;
    }

    await callMatrixApi(
        {
            operasi: 'manual_obe',
            matriks_a: { nama: targetKey, data: mat.data },
            obe_params: {
                tipe: obeType,
                row_i: rowI,
                row_j: rowJ,
                k: kVal
            },
            is_augmented: isAugmented,
            split_col: isAugmented ? mat.cols - 1 : null
        },
        'Gagal menerapkan operasi baris elementer.',
        (data) => {
            if (saveBackToMatrix && data.hasil_grid) {
                mat.data = JSON.parse(JSON.stringify(data.hasil_grid));
                renderMatrixGrid(targetKey);
                saveMatrixState();
            }
        }
    );
}

const MATRIX_PRESETS = {
    tambah2x2: {
        op: 'tambah',
        A: [['1', '2'], ['3', '4']],
        B: [['5', '6'], ['7', '8']]
    },
    kurang2x2: {
        op: 'kurang',
        A: [['9', '5'], ['7', '4']],
        B: [['3', '2'], ['1', '2']]
    },
    kali2x3_3x2: {
        op: 'kali',
        A: [['1', '2', '3'], ['4', '5', '6']],
        B: [['7', '8'], ['9', '1'], ['2', '3']]
    },
    bagi2x2: {
        op: 'bagi',
        A: [['1', '2'], ['3', '4']],
        B: [['2', '0'], ['1', '2']]
    },
    ordo3x3: {
        op: 'kali',
        A: [['1', '2', '3'], ['0', '1', '4'], ['5', '6', '0']],
        B: [['2', '0', '-1'], ['1', '3', '2'], ['0', '-2', '1']]
    },
    gauss3x3: {
        op: 'eselon',
        A: [['1', '2', '-1'], ['2', '3', '1'], ['-1', '1', '2']],
        B: [['1', '0', '0'], ['0', '1', '0'], ['0', '0', '1']]
    },
    rref3x3: {
        op: 'eselon_tereduksi',
        A: [['1', '2', '-1'], ['2', '3', '1'], ['-1', '1', '2']],
        B: [['1', '0', '0'], ['0', '1', '0'], ['0', '0', '1']]
    },
    spl3x4: {
        op: 'spl_augmented',
        A: [['1', '2', '-1', '4'], ['2', '3', '1', '3'], ['-1', '1', '2', '1']],
        B: [['4'], ['3'], ['1']]
    },
    spl2x3: {
        op: 'spl_augmented',
        A: [['2', '1', '5'], ['1', '-1', '1']],
        B: [['5'], ['1']]
    },
    spl_inconsistent: {
        op: 'spl_augmented',
        A: [['1', '1', '1', '3'], ['1', '2', '3', '0'], ['1', '3', '5', '1']],
        B: [['3'], ['0'], ['1']]
    },
    augmented_ab: {
        op: 'augmented',
        A: [['1', '2', '0'], ['3', '4', '1'], ['0', '1', '5']],
        B: [['7'], ['2'], ['9']]
    }
};

function loadMatrixPreset(type) {
    const p = MATRIX_PRESETS[type];
    if (!p) return;

    matrixState.order = ['A', 'B'];
    matrixState.matrices = {
        'A': { name: 'A', rows: p.A.length, cols: p.A[0].length, data: JSON.parse(JSON.stringify(p.A)) },
        'B': { name: 'B', rows: p.B.length, cols: p.B[0].length, data: JSON.parse(JSON.stringify(p.B)) }
    };
    matrixState.currentOp = p.op;
    matrixState.opA = 'A';
    matrixState.opB = 'B';

    renderMatrixCards();
    updateMatrixDropdowns();
    updateMatrixOpUI();
    saveMatrixState();
    checkMatrixCompatibility();
    hitungMatriks();
}

function copyMatrixLatex() {
    if (!lastMatrixResult || !lastMatrixResult.hasil_latex) return;
    copyToClipboard(lastMatrixResult.hasil_latex, {
        alertMsg: 'LaTeX berhasil disalin!',
        promptMsg: 'Salin kode LaTeX berikut:'
    });
}

function copyMatrixPlainText() {
    if (!lastMatrixResult || !lastMatrixResult.hasil_grid) return;
    const txt = lastMatrixResult.hasil_grid.map((row) => row.join('\t')).join('\n');
    copyToClipboard(txt, {
        alertMsg: 'Tabel angka berhasil disalin!',
        promptMsg: 'Salin data berikut:'
    });
}

function saveResultAsNewMatrix() {
    if (!lastMatrixResult || !lastMatrixResult.hasil_grid) return;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let nextLetter = null;
    for (let i = 0; i < alphabet.length; i++) {
        if (!matrixState.order.includes(alphabet[i])) {
            nextLetter = alphabet[i];
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

    $(`matrix-card-${nextLetter}`)?.scrollIntoView({ behavior: 'smooth' });
}

function updateMatrixStoreMenu() {
    const menu = $('menu-store-matrix');
    if (!menu) return;
    menu.innerHTML = matrixState.order.map((key) => {
        return `<button type="button" class="dropdown-item" onclick="copyResultToMatrix('${key}')">Ke Matriks ${key}</button>`;
    }).join('');
}

function toggleMatrixStoreMenu() {
    $('menu-store-matrix')?.classList.toggle('hidden');
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

    $('menu-store-matrix')?.classList.add('hidden');
    $(`matrix-card-${targetKey}`)?.scrollIntoView({ behavior: 'smooth' });
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

$('limit-arah')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') hitungLimit();
});

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
    [...formulas, ...formulas].forEach((f) => {
        const span = document.createElement('span');
        span.className = 'hero-formula-item';
        safeKatexRender(f, span, false);
        track.appendChild(span);
    });
})();

if (location.hash.includes('grafik=')) {
    setTimeout(() => {
        document.querySelector('[data-tab="grafik"]')?.click();
    }, 200);
}

// =============================================================================
// SECTION 12: AUTO-RESET & SERVER-LOAD PROTECTION MANAGER (SILENT)
// =============================================================================
const AUTO_RESET_TIMEOUT_MS = 5 * 60 * 1000;
let pageHiddenTime = null;
let lastUserActivityTime = Date.now();
let awayAbortTimer = null;
let activityThrottleTimer = null;

function recordUserActivity() {
    lastUserActivityTime = Date.now();
}

function onUserInteraction() {
    if (!activityThrottleTimer) {
        recordUserActivity();
        activityThrottleTimer = setTimeout(() => {
            activityThrottleTimer = null;
        }, 1000);
    }
}

['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach((evt) => {
    window.addEventListener(evt, onUserInteraction, { passive: true });
});

function resetCalculusTab(tab) {
    const input = $(FIELD_MAP[tab]);
    if (input) input.value = '';
    const hasil = $('hasil-' + tab);
    if (hasil) hasil.innerHTML = '';
    $('actions-' + tab)?.classList.add('hidden');
    hidePlot(tab);
    showValid(tab, '', '');
    setLoading($('btn-' + tab), false);
}

function resetApp() {
    abortActiveRequests();

    // Reset Tabs Kalkulus
    resetCalculusTab('turunan');
    if ($('turunan-titik')) $('turunan-titik').value = '';
    if ($('turunan-orde')) $('turunan-orde').value = '1';

    resetCalculusTab('integral');
    if ($('integral-bawah')) $('integral-bawah').value = '';
    if ($('integral-atas')) $('integral-atas').value = '';

    resetCalculusTab('limit');
    if ($('limit-titik')) $('limit-titik').value = '0';
    if ($('limit-arah')) $('limit-arah').value = '+-';

    // Reset Matriks
    matrixState.order = ['A', 'B'];
    matrixState.currentOp = 'tambah';
    matrixState.opA = 'A';
    matrixState.opB = 'B';
    matrixState.matrices = {
        'A': { name: 'A', rows: 2, cols: 2, data: [['1', '2'], ['3', '4']] },
        'B': { name: 'B', rows: 2, cols: 2, data: [['5', '6'], ['7', '8']] }
    };
    saveMatrixState();
    renderMatrixCards();
    updateMatrixDropdowns();
    updateMatrixOpUI();
    checkMatrixCompatibility();
    const hasilMatriks = $('hasil-matriks');
    if (hasilMatriks) hasilMatriks.innerHTML = '';
    $('actions-matriks')?.classList.add('hidden');
    $('steps-matriks-wrap')?.classList.add('hidden');
    $('matrix-scalar-wrap')?.classList.add('hidden');
    setLoading($('btn-matrix'), false);
    lastMatrixResult = null;

    // Reset Grafik
    const grafikList = $('grafik-list');
    if (grafikList) {
        grafikList.innerHTML = '';
        addGrafikRow('x^2', true);
        setGrafikRange(-10, 10, -10, 10);
        saveGrafikState();
        renderGrafik();
    }
    $('grafik-error')?.classList.add('hidden');

    // Bersihkan hash URL
    if (window.location.hash) {
        try {
            history.replaceState(null, '', window.location.pathname + window.location.search);
        } catch (e) { }
    }

    // Bersihkan cache hasil & plot
    for (const k in last) delete last[k];
    for (const k in plotSvgCache) delete plotSvgCache[k];

    // Kembali ke tab awal (Turunan)
    const defaultTab = document.querySelector('.tab[data-tab="turunan"]');
    if (defaultTab && !defaultTab.classList.contains('active')) {
        defaultTab.click();
    }

    // Tutup panduan
    const globalPanduan = $('panduan');
    if (globalPanduan && !globalPanduan.classList.contains('hidden')) {
        togglePanduan();
    }
    ['p-turunan', 'p-integral', 'p-limit', 'p-matriks', 'p-grafik'].forEach((id) => {
        const body = $(id);
        if (body && !body.classList.contains('hidden')) {
            toggleCardPanduan(id, 'pt-' + id.replace('p-', ''));
        }
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        pageHiddenTime = Date.now();
        if (awayAbortTimer) clearTimeout(awayAbortTimer);
        awayAbortTimer = setTimeout(() => {
            if (document.visibilityState === 'hidden') {
                abortActiveRequests();
            }
        }, 3000);
    } else if (document.visibilityState === 'visible') {
        if (awayAbortTimer) {
            clearTimeout(awayAbortTimer);
            awayAbortTimer = null;
        }

        const elapsed = pageHiddenTime ? (Date.now() - pageHiddenTime) : 0;
        if (pageHiddenTime && elapsed >= AUTO_RESET_TIMEOUT_MS) {
            resetApp();
        }
        pageHiddenTime = null;
        lastUserActivityTime = Date.now();
    }
});

window.addEventListener('blur', () => {
    if (!pageHiddenTime) pageHiddenTime = Date.now();
});

window.addEventListener('focus', () => {
    const elapsed = pageHiddenTime ? (Date.now() - pageHiddenTime) : 0;
    if (pageHiddenTime && elapsed >= AUTO_RESET_TIMEOUT_MS) {
        resetApp();
    }
    pageHiddenTime = null;
    lastUserActivityTime = Date.now();
});

setInterval(() => {
    const now = Date.now();
    if (document.visibilityState === 'visible') {
        if (now - lastUserActivityTime >= AUTO_RESET_TIMEOUT_MS) {
            lastUserActivityTime = now;
            resetApp();
        }
    } else {
        if (pageHiddenTime && (now - pageHiddenTime >= AUTO_RESET_TIMEOUT_MS)) {
            abortActiveRequests();
            resetApp();
            pageHiddenTime = null;
            lastUserActivityTime = Date.now();
        }
    }
}, 10000);

// =============================================================================
// SECTION 13: GLOBAL WINDOW EXPORTS (GUARANTEE ACCESSIBILITY FOR INLINE ONCLICK)
// =============================================================================
window.abortActiveRequests = abortActiveRequests;
window.addGrafikRow = addGrafikRow;
window.addMatrixVariable = addMatrixVariable;
window.analyzeActiveGrafik = analyzeActiveGrafik;
window.applyDomainToGraph = applyDomainToGraph;
window.autoFixAndFocus = autoFixAndFocus;
window.autoFixDimensions = autoFixDimensions;
window.changeMatrixDim = changeMatrixDim;
window.clearMatrix = clearMatrix;
window.closeGrafikAnalysis = closeGrafikAnalysis;
window.closeValuesTableCard = closeValuesTableCard;
window.copyLatex = copyLatex;
window.copyMatrixLatex = copyMatrixLatex;
window.copyMatrixPlainText = copyMatrixPlainText;
window.copyResultToMatrix = copyResultToMatrix;
window.copyValuesTable = copyValuesTable;
window.downloadGrafikAs = downloadGrafikAs;
window.downloadPlotAs = downloadPlotAs;
window.evalSinglePoint = evalSinglePoint;
window.fillActive = fillActive;
window.fillField = fillField;
window.fillIntegral = fillIntegral;
window.fillLimit = fillLimit;
window.fillMatrixIdentity = fillMatrixIdentity;
window.fillMatrixRandom = fillMatrixRandom;
window.fillMatrixZeros = fillMatrixZeros;
window.fillTurunan = fillTurunan;
window.generateValuesTableRange = generateValuesTableRange;
window.hitungIntegral = hitungIntegral;
window.hitungLimit = hitungLimit;
window.hitungMatriks = hitungMatriks;
window.hitungTurunan = hitungTurunan;
window.initMatrixTab = initMatrixTab;
window.isValidPlotExpr = isValidPlotExpr;
window.loadMatrixPreset = loadMatrixPreset;
window.onMatrixOperandChange = onMatrixOperandChange;
window.onObeTypeChange = onObeTypeChange;
window.onScalarTargetChange = onScalarTargetChange;
window.openValuesTableDirect = openValuesTableDirect;
window.removeMatrixVariable = removeMatrixVariable;
window.renderGrafik = renderGrafik;
window.resetApp = resetApp;
window.resetGrafikView = resetGrafikView;
window.runBinaryOpDirect = runBinaryOpDirect;
window.runManualObe = runManualObe;
window.runScalarOp = runScalarOp;
window.runSplAugmentedOp = runSplAugmentedOp;
window.runUnaryMatrixOp = runUnaryMatrixOp;
window.saveResultAsNewMatrix = saveResultAsNewMatrix;
window.selectMatrixOp = selectMatrixOp;
window.setGrafikRange = setGrafikRange;
window.setMatrixDimensions = setMatrixDimensions;
window.shareGrafik = shareGrafik;
window.toPlotExpr = toPlotExpr;
window.toggleCardPanduan = toggleCardPanduan;
window.toggleDerivativeFromAnalysis = toggleDerivativeFromAnalysis;
window.toggleDerivativeOverlay = toggleDerivativeOverlay;
window.toggleDownloadMenu = toggleDownloadMenu;
window.toggleMatrixSteps = toggleMatrixSteps;
window.toggleMatrixStoreMenu = toggleMatrixStoreMenu;
window.toggleObeManualInput = toggleObeManualInput;
window.togglePanduan = togglePanduan;
window.toggleScalarInput = toggleScalarInput;
window.toggleValuesTable = toggleValuesTable;
window.updateObeRowOptions = updateObeRowOptions;
window.updateThemeIcons = updateThemeIcons;
window.zoomGrafik = zoomGrafik;
window.clearAllGrafikRows = clearAllGrafikRows;
window.parseDesmosEquation = parseDesmosEquation;
window.parseParametricPair = parseParametricPair;
window.createParametricEvaluator = createParametricEvaluator;
window.getParametricBounds = getParametricBounds;
window.showGrafikToast = showGrafikToast;
