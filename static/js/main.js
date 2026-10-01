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

const SUPERSCRIPTS_MAP = {
    '⁰': '^0', '¹': '^1', '²': '^2', '³': '^3', '⁴': '^4',
    '⁵': '^5', '⁶': '^6', '⁷': '^7', '⁸': '^8', '⁹': '^9',
    '⁻': '^-', '⁺': '^+'
};

/**
 * Auto-correct common mathematical input typos (e.g., missing '*' before variables/brackets, unicode superscripts, commas).
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

    // Batalkan kalkulasi sebelumnya jika ada yang masih berlangsung
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
let zoomResampleTimer = null;
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
                if (parsed.xmin !== undefined) state.xmin = parsed.xmin;
                if (parsed.xmax !== undefined) state.xmax = parsed.xmax;
                if (parsed.ymin !== undefined) state.ymin = parsed.ymin;
                if (parsed.ymax !== undefined) state.ymax = parsed.ymax;
            }
        }
    } catch (e) { }

    if (state) {
        if (Number.isFinite(Number(state.xmin))) currentGrafikDomain.xmin = Number(state.xmin);
        if (Number.isFinite(Number(state.xmax))) currentGrafikDomain.xmax = Number(state.xmax);
        if (Number.isFinite(Number(state.ymin))) currentGrafikDomain.ymin = Number(state.ymin);
        if (Number.isFinite(Number(state.ymax))) currentGrafikDomain.ymax = Number(state.ymax);
    }

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
    let xmin = currentGrafikDomain.xmin;
    let xmax = currentGrafikDomain.xmax;
    let ymin = currentGrafikDomain.ymin;
    let ymax = currentGrafikDomain.ymax;

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
            graphType: 'polyline',
            sampler: 'builtIn',
            nSamples: 1200
        });
    });

    // Optional: First derivative overlay curve
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

        // 5. Real-time bi-directional zoom & pan synchronization with auto re-sampling
        try {
            instance.on('all:zoom', (xScale, yScale) => {
                isZoomingPlot = true;
                const xd = xScale.domain();
                const yd = yScale.domain();
                currentGrafikDomain.xmin = Number(xd[0].toFixed(3));
                currentGrafikDomain.xmax = Number(xd[1].toFixed(3));
                currentGrafikDomain.ymin = Number(yd[0].toFixed(3));
                currentGrafikDomain.ymax = Number(yd[1].toFixed(3));
                debouncedSaveGrafikState();

                // Re-sample 1200 points on current visible viewport when user finishes zooming/panning
                clearTimeout(zoomResampleTimer);
                zoomResampleTimer = setTimeout(() => {
                    isZoomingPlot = false;
                    saveGrafikState();
                    renderGrafik();
                }, 220);
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

// Zooming controls (+ / -)
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

// Helper: Ambil fungsi grafik yang sedang aktif
function getActiveGrafikFn() {
    const inputs = Array.from(document.querySelectorAll('#grafik-list .grafik-input'));
    const focused = document.activeElement;
    if (focused && focused.classList && focused.classList.contains('grafik-input') && focused.value.trim()) {
        return focused.value.trim();
    }
    const found = inputs.find(i => i.value.trim());
    return found ? found.value.trim() : '';
}

// Analisis Fungsi & Penentuan Domain Alami Otomatis
async function analyzeActiveGrafik() {
    const targetVal = getActiveGrafikFn();

    if (!targetVal) {
        showGrafikError('Masukkan fungsi terlebih dahulu pada kotak fungsi.');
        return;
    }

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

        renderNaturalDomainAnalysis(data);
    } catch (err) {
        loading.classList.add('hidden');
        body.innerHTML = `<div class="grafik-error" style="margin-top:0">Terjadi kesalahan: ${err.message || err}</div>`;
    }
}

function renderNaturalDomainAnalysis(data) {
    const body = $('grafik-analysis-body');
    if (!body) return;

    let html = `
        <div class="grafik-domain-box">
            <div class="grafik-domain-label">Daerah Asal Alami (Natural Domain $D_f$)</div>
            <div class="grafik-domain-val" id="g-domain-math"></div>
            ${data.domain_himpunan ? `<div class="grafik-domain-sub" id="g-domain-set"></div>` : ''}
        </div>
    `;

    // Syarat-syarat pembatas
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

    // Karakteristik kurva
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

    // Turunan Pertama f'(x) Card - BESAR, JELAS & MENONJOL
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

        <!-- Tombol Buka Tabel Nilai Evaluasi -->
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

    // Render KaTeX expressions
    if (typeof katex !== 'undefined') {
        const mathDomEl = $('g-domain-math');
        if (mathDomEl && data.domain_latex) {
            katex.render(`D_f = ${data.domain_latex}`, mathDomEl, { throwOnError: false, displayMode: true });
        }
        const setDomEl = $('g-domain-set');
        if (setDomEl && data.domain_himpunan) {
            katex.render(`\\text{Notasi Himpunan: } ${data.domain_himpunan}`, setDomEl, { throwOnError: false, displayMode: false });
        }
        document.querySelectorAll('.g-syarat-math').forEach(el => {
            const m = el.getAttribute('data-math') || '';
            if (m.includes('$$')) {
                const parts = m.split('$$');
                el.innerHTML = parts.map((part, i) => {
                    if (i % 2 === 1) {
                        return katex.renderToString(part, { throwOnError: false, displayMode: true });
                    }
                    return part;
                }).join('');
            } else {
                katex.render(m, el, { throwOnError: false, displayMode: false });
            }
        });

        const rootsEl = $('g-feat-roots');
        if (rootsEl) {
            if (data.akar && data.akar.length) {
                katex.render(`x \\in \\{${data.akar.join(', ')}\\}`, rootsEl, { throwOnError: false, displayMode: false });
            } else {
                rootsEl.textContent = 'Tidak ada';
            }
        }

        const yintEl = $('g-feat-yint');
        if (yintEl) {
            if (data.potong_y) {
                katex.render(`(0, ${data.potong_y})`, yintEl, { throwOnError: false, displayMode: false });
            } else {
                yintEl.textContent = 'Tidak ada';
            }
        }

        const vasympEl = $('g-feat-vasymp');
        if (vasympEl) {
            if (data.asimtot_tegak && data.asimtot_tegak.length) {
                katex.render(`x = ${data.asimtot_tegak.join(', ')}`, vasympEl, { throwOnError: false, displayMode: false });
            } else {
                vasympEl.textContent = 'Tidak ada';
            }
        }

        const hasympEl = $('g-feat-hasymp');
        if (hasympEl) {
            if (data.asimtot_datar && data.asimtot_datar.length) {
                katex.render(`y = ${data.asimtot_datar.join(', ')}`, hasympEl, { throwOnError: false, displayMode: false });
            } else {
                hasympEl.textContent = 'Tidak ada';
            }
        }

        const critEl = $('g-feat-crit');
        if (critEl) {
            if (data.titik_stasioner && data.titik_stasioner.length) {
                const ptsStr = data.titik_stasioner.map(p => `(${p.x}, ${p.y})`).join(', ');
                katex.render(ptsStr, critEl, { throwOnError: false, displayMode: false });
            } else {
                critEl.textContent = 'Tidak ada';
            }
        }

        const symEl = $('g-feat-sym');
        if (symEl) {
            symEl.textContent = data.simetri || 'Bukan keduanya';
        }

        const slantEl = $('g-feat-slant');
        if (slantEl && data.asimtot_miring) {
            katex.render(`y = ${data.asimtot_miring}`, slantEl, { throwOnError: false, displayMode: false });
        }

        const derivEl = $('g-feat-deriv');
        if (derivEl && data.turunan_latex) {
            katex.render(`f'(x) = ${data.turunan_latex}`, derivEl, { throwOnError: false, displayMode: true });
        }
    }
}

function applyDomainToGraph() {
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

function toggleDerivativeOverlay() {
    const cb = $('grafik-toggle-deriv');
    isDerivativeOverlayActive = !!(cb && cb.checked);
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
    const cb = $('grafik-toggle-deriv');
    if (cb) {
        cb.checked = !cb.checked;
        toggleDerivativeOverlay();
    } else {
        isDerivativeOverlayActive = !isDerivativeOverlayActive;
        updateDerivativeCardButton();
        renderGrafik();
    }
}

function updateDerivativeCardButton() {
    const btn = $('btn-plot-deriv-card');
    const lbl = $('btn-plot-deriv-label');
    if (!btn) return;
    if (isDerivativeOverlayActive) {
        btn.classList.add('active');
        if (lbl) lbl.textContent = 'Kurva Aktif di Grafik';
    } else {
        btn.classList.remove('active');
        if (lbl) lbl.textContent = 'Tampilkan Kurva di Grafik';
    }
}

// =============================================================================
// EVALUASI TITIK & TABEL NILAI MATEMATIS
// =============================================================================
function evaluateMathPoint(exprStr, xVal) {
    if (!exprStr || !exprStr.trim()) {
        return { x: xVal, y: 'Tak terdefinisi', terdefinisi: false };
    }
    try {
        let clean = toPlotExpr(exprStr);
        if (!isValidPlotExpr(clean)) {
            return { x: xVal, y: 'Format tidak valid', terdefinisi: false };
        }
        clean = clean.replaceAll('^', '**');

        const mathFuncs = [
            'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
            'sinh', 'cosh', 'tanh', 'sqrt', 'cbrt', 'exp',
            'log10', 'log', 'abs'
        ];
        for (const fn of mathFuncs) {
            const regex = new RegExp(`\\b${fn}\\b`, 'g');
            clean = clean.replace(regex, `Math.${fn}`);
        }
        clean = clean.replace(/\bPI\b/g, 'Math.PI');

        const evalFn = new Function('x', 'Math', `"use strict"; return (${clean});`);
        const res = evalFn(xVal, Math);

        if (typeof res !== 'number' || isNaN(res) || !isFinite(res)) {
            return { x: xVal, y: 'Tak terdefinisi', terdefinisi: false };
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
    if (titleEl) {
        titleEl.textContent = `Tabel Nilai Evaluasi: f(x) = ${fn}`;
    }

    const evalRes = $('val-eval-result');
    if (evalRes) evalRes.classList.add('hidden');
    const evalInp = $('val-eval-x');
    if (evalInp && !evalInp.value) evalInp.value = '2';

    const activeChip = $('chip-tbl-5');
    generateValuesTableRange(-5, 5, 1, activeChip);

    card.classList.remove('hidden');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeValuesTableCard() {
    const card = $('grafik-values-card');
    if (card) card.classList.add('hidden');
}

function generateValuesTableRange(start, end, step, clickedBtn) {
    const fn = getActiveGrafikFn();
    const tbody = $('val-table-tbody');
    if (!tbody) return;

    if (clickedBtn) {
        document.querySelectorAll('.val-chip').forEach(b => b.classList.remove('active'));
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
        const xVal = Number(curr.toFixed(3));
        points.push(evaluateMathPoint(fn, xVal));
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

    tbody.innerHTML = points.map(pt => `
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

    let lines = [`Tabel Evaluasi f(x) = ${fn || ''}`, '----------------------------------', 'x\tf(x)\tStatus'];
    rows.forEach(tr => {
        const cells = tr.querySelectorAll('td');
        if (cells.length >= 3) {
            const x = cells[0].innerText.replace('*', '').trim();
            const y = cells[1].innerText.trim();
            const st = cells[2].innerText.trim();
            lines.push(`${x}\t${y}\t${st}`);
        }
    });

    const text = lines.join('\n');
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            if (btnText) {
                const old = btnText.textContent;
                btnText.textContent = 'Tersalin!';
                setTimeout(() => { btnText.textContent = old; }, 1500);
            }
        });
    }
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

    const evalInp = $('val-eval-x');
    if (evalInp) {
        evalInp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                evalSinglePoint();
            }
        });
    }

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
    if (!matrixState.order.includes(matrixState.opB)) matrixState.opB = matrixState.order[1] || matrixState.order[0] || 'A';
    if (!matrixState.order.includes(matrixState.scalarTarget)) matrixState.scalarTarget = matrixState.order[0] || 'A';

    selA.innerHTML = buildOptions(matrixState.opA);
    selB.innerHTML = buildOptions(matrixState.opB);
    if (selScalar) selScalar.innerHTML = buildOptions(matrixState.scalarTarget);
    try {
        if (typeof updateObeRowOptions === 'function') {
            updateObeRowOptions();
        }
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

    // Auto-run secara mulus jika format sudah sesuai dan bukan form konfigurasi (skalar/obe)
    if (!['skalar', 'obe_manual'].includes(op)) {
        const matA = matrixState.matrices[matrixState.opA];
        if (matA) {
            const isSingleMatrix = ['determinan', 'invers', 'transpose', 'eselon', 'eselon_tereduksi', 'spl_augmented'].includes(op);
            if (isSingleMatrix) {
                if (['determinan', 'invers'].includes(op) && matA.rows !== matA.cols) {
                    return; // Biarkan asisten menawarkan tombol 'Perbaiki Otomatis'
                }
                if (op === 'spl_augmented' && matA.cols < 2) {
                    return; // Biarkan asisten menawarkan tombol 'Tambah Kolom b'
                }
                hitungMatriks();
            } else {
                if (matrixState.order.length >= 2) {
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
}

function updateMatrixOpUI() {
    const op = matrixState.currentOp || 'tambah';
    const signs = { tambah: '+', kurang: '−', kali: '×', bagi: '÷', augmented: '|', spl_augmented: '|' };

    // Update active class on quick ops, unary grid, and advanced buttons
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
        if (binarySelector) binarySelector.classList.add('hidden');
    } else {
        if (binarySelector) binarySelector.classList.remove('hidden');
        if (isSingleMatrix) {
            if (colB) colB.classList.add('hidden');
            if (signEl) signEl.classList.add('hidden');
            if (labelA) labelA.textContent = 'Pilih Matriks Target';
        } else {
            if (colB) colB.classList.remove('hidden');
            if (signEl) {
                signEl.classList.remove('hidden');
                signEl.textContent = signs[op] || '+';
            }
            if (labelA) labelA.textContent = 'Matriks Pertama';
        }
    }

    // Update text on main button
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
                    <button type="button" onclick="fillMatrixIdentity('${key}')" class="matrix-tool-btn" title="Ubah jadi matriks identitas">Identitas</button>
                    <button type="button" onclick="fillMatrixZeros('${key}')" class="matrix-tool-btn" title="Isi semua dengan angka 0">Nol</button>
                    <button type="button" onclick="fillMatrixRandom('${key}')" class="matrix-tool-btn" title="Isi angka acak">Acak</button>
                    <button type="button" onclick="clearMatrix('${key}')" class="matrix-tool-btn" title="Kosongkan sel">Bersihkan</button>
                    ${canDelete ? `<button type="button" onclick="removeMatrixVariable('${key}')" class="matrix-tool-btn danger" title="Hapus matriks ini">Hapus</button>` : ''}
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

    actionWrap.innerHTML = '';
    actionWrap.classList.add('hidden');

    const op = matrixState.currentOp || 'tambah';
    const keyA = matrixState.opA || matrixState.order[0] || 'A';
    const matA = matrixState.matrices[keyA];

    if (!matA) return;

    const rA = matA.rows;
    const cA = matA.cols;

    const isSingleMatrix = ['determinan', 'invers', 'transpose', 'eselon', 'eselon_tereduksi', 'spl_augmented'].includes(op);

    // KASUS OPERASI SATU MATRIKS (UNARY / LANJUTAN)
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

                actionWrap.classList.remove('hidden');
                const fixBtn = document.createElement('button');
                fixBtn.type = 'button';
                fixBtn.className = 'matrix-fix-btn';
                fixBtn.textContent = `Perbaiki: Ubah Matriks ${keyA} Menjadi Persegi (${rA}×${rA})`;
                fixBtn.onclick = () => autoFixDimensions(keyA, rA, rA);
                actionWrap.appendChild(fixBtn);
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

                actionWrap.classList.remove('hidden');
                const fixBtn = document.createElement('button');
                fixBtn.type = 'button';
                fixBtn.className = 'matrix-fix-btn';
                fixBtn.textContent = `Perbaiki: Tambah Kolom Matriks ${keyA} Menjadi ${Math.max(2, rA + 1)} Kolom`;
                fixBtn.onclick = () => autoFixDimensions(keyA, rA, Math.max(2, rA + 1));
                actionWrap.appendChild(fixBtn);
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

    // KASUS OPERASI DUA MATRIKS (TAMBAH, KURANG, KALI, BAGI, AUGMENTED)
    if (matrixState.order.length < 2) {
        box.className = 'matrix-assistant-box warning';
        icon.textContent = '!';
        const opNames = { tambah: 'Penjumlahan', kurang: 'Pengurangan', kali: 'Perkalian', bagi: 'Pembagian', augmented: 'Gabung Augmented' };
        const opName = opNames[op] || 'Operasi 2 matriks';
        title.textContent = `${opName} Memerlukan 2 Variabel Matriks`;
        desc.textContent = `Saat ini Anda hanya memiliki 1 variabel matriks (Matriks ${keyA}). Klik tombol di bawah untuk menambahkan Matriks B secara instan.`;

        actionWrap.classList.remove('hidden');
        const fixBtn = document.createElement('button');
        fixBtn.type = 'button';
        fixBtn.className = 'matrix-fix-btn';
        fixBtn.textContent = `+ Tambah Matriks B Otomatis`;
        fixBtn.onclick = () => addMatrixBAuto();
        actionWrap.appendChild(fixBtn);
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

            actionWrap.classList.remove('hidden');
            const fixBtn = document.createElement('button');
            fixBtn.type = 'button';
            fixBtn.className = 'matrix-fix-btn';
            fixBtn.textContent = `Perbaiki: Samakan Matriks ${keyB} Menjadi ${rA}×${cA}`;
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
            desc.textContent = `Perkalian ${keyA} × ${keyB} mensyaratkan Kolom Matriks ${keyA} (${cA}) = Baris Matriks ${keyB} (saat ini ${rB}).`;

            actionWrap.classList.remove('hidden');
            const fixBtn = document.createElement('button');
            fixBtn.type = 'button';
            fixBtn.className = 'matrix-fix-btn';
            fixBtn.textContent = `Perbaiki: Ubah Baris Matriks ${keyB} Menjadi ${cA}`;
            fixBtn.onclick = () => autoFixDimensions(keyB, cA, cB);
            actionWrap.appendChild(fixBtn);
        }
    } else if (op === 'bagi') {
        if (rB !== cB) {
            box.className = 'matrix-assistant-box warning';
            icon.textContent = '!';
            title.textContent = `Matriks Pembagi (${keyB}) Harus Persegi`;
            desc.textContent = `Pembagian ${keyA} ÷ ${keyB} dihitung sebagai ${keyA} × ${keyB}⁻¹. Matriks pembagi harus berupa matriks persegi (ordo n×n) agar memiliki invers. (Saat ini ${keyB} berordo ${rB}×${cB}).`;

            actionWrap.classList.remove('hidden');
            const fixBtn = document.createElement('button');
            fixBtn.type = 'button';
            fixBtn.className = 'matrix-fix-btn';
            fixBtn.textContent = `Perbaiki: Ubah Matriks ${keyB} Menjadi Persegi (${rB}×${rB})`;
            fixBtn.onclick = () => autoFixDimensions(keyB, rB, rB);
            actionWrap.appendChild(fixBtn);
        } else if (cA !== rB) {
            box.className = 'matrix-assistant-box warning';
            icon.textContent = '!';
            title.textContent = `Dimensi Pengali Belum Cocok`;
            desc.textContent = `Kolom Matriks ${keyA} (${cA}) harus sama dengan ordo invers ${keyB} (${rB}).`;

            actionWrap.classList.remove('hidden');
            const fixBtn = document.createElement('button');
            fixBtn.type = 'button';
            fixBtn.className = 'matrix-fix-btn';
            fixBtn.textContent = `Perbaiki: Sesuaikan Kolom Matriks ${keyA} Menjadi ${rB}`;
            fixBtn.onclick = () => autoFixDimensions(keyA, rA, rB);
            actionWrap.appendChild(fixBtn);
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

            actionWrap.classList.remove('hidden');
            const fixBtn = document.createElement('button');
            fixBtn.type = 'button';
            fixBtn.className = 'matrix-fix-btn';
            fixBtn.textContent = `Perbaiki: Samakan Baris Matriks ${keyB} Menjadi ${rA}`;
            fixBtn.onclick = () => autoFixDimensions(keyB, rA, cB);
            actionWrap.appendChild(fixBtn);
        }
    }
}

async function hitungMatriks() {
    const op = matrixState.currentOp || 'tambah';

    if (op === 'skalar') {
        return runScalarOp();
    }
    if (op === 'obe_manual') {
        return runManualObe(false);
    }
    if (['determinan', 'invers', 'transpose', 'eselon', 'eselon_tereduksi'].includes(op)) {
        return runUnaryMatrixOp(op);
    }
    if (op === 'spl_augmented') {
        return runSplAugmentedOp();
    }

    // Operasi 2 matriks
    if (matrixState.order.length < 2) {
        addMatrixBAuto();
        return;
    }

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
        operasi: op,
        matriks_a: { nama: keyA, data: matA.data },
        matriks_b: { nama: keyB, data: matB.data }
    };

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
                try {
                    katex.render(solStr, chip, { throwOnError: false, displayMode: false });
                } catch (err) {
                    chip.textContent = solStr;
                }
                solGrid.appendChild(chip);
            });
            splCard.appendChild(solGrid);
        }

        wrap.appendChild(splCard);
    }

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

    abortActiveRequests();
    currentAbortController = new AbortController();

    try {
        const res = await fetch('/api/matrix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                operasi: op,
                matriks_a: { nama: targetKey, data: mat.data }
            }),
            signal: currentAbortController.signal
        });
        const data = await res.json();
        if (data.sukses) {
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

    abortActiveRequests();
    currentAbortController = new AbortController();

    try {
        const res = await fetch('/api/matrix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                operasi: 'skalar',
                skalar: k,
                matriks_a: { nama: targetKey, data: mat.data }
            }),
            signal: currentAbortController.signal
        });
        const data = await res.json();
        if (data.sukses) {
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
        renderMatrixErrorResult('Gagal menghitung perkalian skalar.');
    } finally {
        setLoading(btn, false);
    }
}

async function runSplAugmentedOp() {
    const targetKey = matrixState.opA || matrixState.order[0];
    const mat = matrixState.matrices[targetKey];
    if (!mat) return;

    if (mat.cols < 2) {
        alert('Matriks augmented untuk SPL membutuhkan minimal 2 kolom (minimal 1 kolom variabel dan 1 kolom konstanta b). Silakan tambah kolom matriks.');
        return;
    }

    const btn = $('btn-matrix');
    const resultEl = $('hasil-matriks');
    setLoading(btn, true);
    resultEl.innerHTML = '<div class="skeleton-wrap"><div class="skeleton-line w80"></div><div class="skeleton-line w60"></div></div>';
    $('actions-matriks').classList.add('hidden');
    $('steps-matriks-wrap').classList.add('hidden');

    abortActiveRequests();
    currentAbortController = new AbortController();

    try {
        const res = await fetch('/api/matrix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                operasi: 'spl_augmented',
                matriks_a: { nama: targetKey, data: mat.data },
                is_augmented: true,
                split_col: mat.cols - 1
            }),
            signal: currentAbortController.signal
        });
        const data = await res.json();
        if (data.sukses) {
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
        renderMatrixErrorResult('Gagal menyelesaikan SPL dari matriks augmented.');
    } finally {
        setLoading(btn, false);
    }
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
        if (fieldK) fieldK.classList.add('hidden');
        if (fieldRowJ) fieldRowJ.classList.remove('hidden');
        if (labelRowI) labelRowI.textContent = 'Baris Pertama (Ri)';
    } else if (type === 'skalar') {
        if (fieldK) fieldK.classList.remove('hidden');
        if (fieldRowJ) fieldRowJ.classList.add('hidden');
        if (labelRowI) labelRowI.textContent = 'Baris yang Dikalikan (Ri)';
    } else if (type === 'tambah') {
        if (fieldK) fieldK.classList.remove('hidden');
        if (fieldRowJ) fieldRowJ.classList.remove('hidden');
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

    const btn = $('btn-matrix');
    const resultEl = $('hasil-matriks');
    setLoading(btn, true);
    resultEl.innerHTML = '<div class="skeleton-wrap"><div class="skeleton-line w80"></div><div class="skeleton-line w60"></div></div>';
    $('actions-matriks').classList.add('hidden');
    $('steps-matriks-wrap').classList.add('hidden');

    abortActiveRequests();
    currentAbortController = new AbortController();

    try {
        const res = await fetch('/api/matrix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
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
            }),
            signal: currentAbortController.signal
        });
        const data = await res.json();
        if (data.sukses) {
            if (saveBackToMatrix && data.hasil_grid) {
                mat.data = JSON.parse(JSON.stringify(data.hasil_grid));
                renderMatrixGrid(targetKey);
                saveMatrixState();
            }
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
        renderMatrixErrorResult('Gagal menerapkan operasi baris elementer.');
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
    } else if (type === 'gauss3x3') {
        matrixState.order = ['A', 'B'];
        matrixState.matrices = {
            'A': { name: 'A', rows: 3, cols: 3, data: [['1', '2', '-1'], ['2', '3', '1'], ['-1', '1', '2']] },
            'B': { name: 'B', rows: 3, cols: 3, data: [['1', '0', '0'], ['0', '1', '0'], ['0', '0', '1']] }
        };
        matrixState.currentOp = 'eselon';
        matrixState.opA = 'A';
        matrixState.opB = 'B';
        renderMatrixCards();
        updateMatrixDropdowns();
        updateMatrixOpUI();
        saveMatrixState();
        checkMatrixCompatibility();
        hitungMatriks();
        return;
    } else if (type === 'rref3x3') {
        matrixState.order = ['A', 'B'];
        matrixState.matrices = {
            'A': { name: 'A', rows: 3, cols: 3, data: [['1', '2', '-1'], ['2', '3', '1'], ['-1', '1', '2']] },
            'B': { name: 'B', rows: 3, cols: 3, data: [['1', '0', '0'], ['0', '1', '0'], ['0', '0', '1']] }
        };
        matrixState.currentOp = 'eselon_tereduksi';
        matrixState.opA = 'A';
        matrixState.opB = 'B';
        renderMatrixCards();
        updateMatrixDropdowns();
        updateMatrixOpUI();
        saveMatrixState();
        checkMatrixCompatibility();
        hitungMatriks();
        return;
    } else if (type === 'spl3x4') {
        matrixState.order = ['A', 'B'];
        matrixState.matrices = {
            'A': { name: 'A', rows: 3, cols: 4, data: [['1', '2', '-1', '4'], ['2', '3', '1', '3'], ['-1', '1', '2', '1']] },
            'B': { name: 'B', rows: 3, cols: 1, data: [['4'], ['3'], ['1']] }
        };
        matrixState.currentOp = 'spl_augmented';
        matrixState.opA = 'A';
        matrixState.opB = 'B';
        renderMatrixCards();
        updateMatrixDropdowns();
        updateMatrixOpUI();
        saveMatrixState();
        checkMatrixCompatibility();
        hitungMatriks();
        return;
    } else if (type === 'spl2x3') {
        matrixState.order = ['A', 'B'];
        matrixState.matrices = {
            'A': { name: 'A', rows: 2, cols: 3, data: [['2', '1', '5'], ['1', '-1', '1']] },
            'B': { name: 'B', rows: 2, cols: 1, data: [['5'], ['1']] }
        };
        matrixState.currentOp = 'spl_augmented';
        matrixState.opA = 'A';
        matrixState.opB = 'B';
        renderMatrixCards();
        updateMatrixDropdowns();
        updateMatrixOpUI();
        saveMatrixState();
        checkMatrixCompatibility();
        hitungMatriks();
        return;
    } else if (type === 'spl_inconsistent') {
        matrixState.order = ['A', 'B'];
        matrixState.matrices = {
            'A': { name: 'A', rows: 3, cols: 4, data: [['1', '1', '1', '3'], ['1', '2', '3', '0'], ['1', '3', '5', '1']] },
            'B': { name: 'B', rows: 3, cols: 1, data: [['3'], ['0'], ['1']] }
        };
        matrixState.currentOp = 'spl_augmented';
        matrixState.opA = 'A';
        matrixState.opB = 'B';
        renderMatrixCards();
        updateMatrixDropdowns();
        updateMatrixOpUI();
        saveMatrixState();
        checkMatrixCompatibility();
        hitungMatriks();
        return;
    } else if (type === 'augmented_ab') {
        matrixState.order = ['A', 'B'];
        matrixState.matrices = {
            'A': { name: 'A', rows: 3, cols: 3, data: [['1', '2', '0'], ['3', '4', '1'], ['0', '1', '5']] },
            'B': { name: 'B', rows: 3, cols: 1, data: [['7'], ['2'], ['9']] }
        };
        matrixState.currentOp = 'augmented';
        matrixState.opA = 'A';
        matrixState.opB = 'B';
        renderMatrixCards();
        updateMatrixDropdowns();
        updateMatrixOpUI();
        saveMatrixState();
        checkMatrixCompatibility();
        hitungMatriks();
        return;
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
window.zoomGrafik = zoomGrafik;
window.analyzeActiveGrafik = analyzeActiveGrafik;
window.applyDomainToGraph = applyDomainToGraph;
window.closeGrafikAnalysis = closeGrafikAnalysis;
window.toggleDerivativeOverlay = toggleDerivativeOverlay;
window.toggleValuesTable = toggleValuesTable;
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
window.runSplAugmentedOp = runSplAugmentedOp;
window.runBinaryOpDirect = runBinaryOpDirect;
window.toggleObeManualInput = toggleObeManualInput;
window.onObeTypeChange = onObeTypeChange;
window.updateObeRowOptions = updateObeRowOptions;
window.runManualObe = runManualObe;
window.copyMatrixLatex = copyMatrixLatex;
window.copyMatrixPlainText = copyMatrixPlainText;
window.saveResultAsNewMatrix = saveResultAsNewMatrix;
window.toggleMatrixStoreMenu = toggleMatrixStoreMenu;
window.copyResultToMatrix = copyResultToMatrix;
window.togglePanduan = togglePanduan;
window.toggleCardPanduan = toggleCardPanduan;
window.resetApp = resetApp;
window.abortActiveRequests = abortActiveRequests;

// =============================================================================
// SECTION 13: AUTO-RESET & SERVER-LOAD PROTECTION MANAGER (SILENT)
// =============================================================================
const AUTO_RESET_TIMEOUT_MS = 5 * 60 * 1000; // 5 menit (300.000 ms)
let pageHiddenTime = null;
let lastUserActivityTime = Date.now();
let awayAbortTimer = null;

function recordUserActivity() {
    lastUserActivityTime = Date.now();
}

let activityThrottleTimer = null;
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

function resetApp() {
    // 1. Batalkan semua request fetch yang sedang berjalan ke server
    abortActiveRequests();

    // 2. Reset Tab Turunan
    const turunanFungsi = $('turunan-fungsi');
    if (turunanFungsi) turunanFungsi.value = '';
    const turunanTitik = $('turunan-titik');
    if (turunanTitik) turunanTitik.value = '';
    const turunanOrde = $('turunan-orde');
    if (turunanOrde) turunanOrde.value = '1';
    const hasilTurunan = $('hasil-turunan');
    if (hasilTurunan) hasilTurunan.innerHTML = '';
    const actionsTurunan = $('actions-turunan');
    if (actionsTurunan) actionsTurunan.classList.add('hidden');
    hidePlot('turunan');
    showValid('turunan', '', '');
    setLoading($('btn-turunan'), false);

    // 3. Reset Tab Integral
    const integralFungsi = $('integral-fungsi');
    if (integralFungsi) integralFungsi.value = '';
    const integralBawah = $('integral-bawah');
    if (integralBawah) integralBawah.value = '';
    const integralAtas = $('integral-atas');
    if (integralAtas) integralAtas.value = '';
    const hasilIntegral = $('hasil-integral');
    if (hasilIntegral) hasilIntegral.innerHTML = '';
    const actionsIntegral = $('actions-integral');
    if (actionsIntegral) actionsIntegral.classList.add('hidden');
    hidePlot('integral');
    showValid('integral', '', '');
    setLoading($('btn-integral'), false);

    // 4. Reset Tab Limit
    const limitFungsi = $('limit-fungsi');
    if (limitFungsi) limitFungsi.value = '';
    const limitTitik = $('limit-titik');
    if (limitTitik) limitTitik.value = '0';
    const limitArah = $('limit-arah');
    if (limitArah) limitArah.value = '+-';
    const hasilLimit = $('hasil-limit');
    if (hasilLimit) hasilLimit.innerHTML = '';
    const actionsLimit = $('actions-limit');
    if (actionsLimit) actionsLimit.classList.add('hidden');
    hidePlot('limit');
    showValid('limit', '', '');
    setLoading($('btn-limit'), false);

    // 5. Reset Matriks ke state bawaan
    matrixState.order = ['A', 'B'];
    matrixState.currentOp = 'ADD';
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
    const actionsMatriks = $('actions-matriks');
    if (actionsMatriks) actionsMatriks.classList.add('hidden');
    const stepsMatriks = $('steps-matriks-wrap');
    if (stepsMatriks) stepsMatriks.classList.add('hidden');
    const scalarWrap = $('matrix-scalar-wrap');
    if (scalarWrap) scalarWrap.classList.add('hidden');
    setLoading($('btn-matrix'), false);
    lastMatrixResult = null;

    // 6. Reset Grafik
    const grafikList = $('grafik-list');
    if (grafikList) {
        grafikList.innerHTML = '';
        addGrafikRow('x^2', true);
        setGrafikRange(-10, 10, -10, 10);
        saveGrafikState();
        renderGrafik();
    }
    const grafikError = $('grafik-error');
    if (grafikError) grafikError.classList.add('hidden');

    // 7. Bersihkan hash URL jika ada state grafik/query
    if (window.location.hash) {
        try {
            history.replaceState(null, '', window.location.pathname + window.location.search);
        } catch (e) { }
    }

    // 8. Bersihkan memori cache SVG & hasil perhitungan tersimpan
    for (const k in last) delete last[k];
    for (const k in plotSvgCache) delete plotSvgCache[k];

    // 9. Kembali ke tab awal (Turunan)
    const defaultTab = document.querySelector('.tab[data-tab="turunan"]');
    if (defaultTab && !defaultTab.classList.contains('active')) {
        defaultTab.click();
    }

    // 10. Tutup accordion panduan jika terbuka
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

    // 11. Scroll ke paling atas secara halus
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Event listener saat visibilitas halaman berubah (keluar tab / pindah aplikasi)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        pageHiddenTime = Date.now();
        // Jika ada kalkulasi berat ke server sedang berjalan, batalkan setelah 3 detik
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
            pageHiddenTime = null;
            lastUserActivityTime = Date.now();
            resetApp();
        } else {
            pageHiddenTime = null;
            lastUserActivityTime = Date.now();
        }
    }
});

// Fallback window blur & focus
window.addEventListener('blur', () => {
    if (!pageHiddenTime) {
        pageHiddenTime = Date.now();
    }
});

window.addEventListener('focus', () => {
    const elapsed = pageHiddenTime ? (Date.now() - pageHiddenTime) : 0;
    if (pageHiddenTime && elapsed >= AUTO_RESET_TIMEOUT_MS) {
        pageHiddenTime = null;
        lastUserActivityTime = Date.now();
        resetApp();
    }
});

// Pemeriksaan berkala (idle di foreground atau background timeout)
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


