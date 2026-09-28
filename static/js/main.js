// =============================================================================
// CalcKu — Main JavaScript (Consolidated)
// =============================================================================

// ===== THEME TOGGLE =====
(function () {
    const saved = localStorage.getItem('calcku-theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcons(saved);
})();

function updateThemeIcons(theme) {
    const moon = document.getElementById('icon-moon');
    const sun = document.getElementById('icon-sun');
    if (!moon || !sun) return;
    if (theme === 'dark') {
        moon.style.display = 'none';
        sun.style.display = 'block';
    } else {
        moon.style.display = 'block';
        sun.style.display = 'none';
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#07090f' : '#ffffff';
}

document.getElementById('theme-toggle-btn').addEventListener('click', function () {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('calcku-theme', next);
    updateThemeIcons(next);
    try { if (document.querySelector('.tab[data-tab="grafik"].active')) renderGrafik(); } catch (e) { }
});

// ===== UTILITIES =====
const $ = id => document.getElementById(id);
const LS_H = 'calcku-h';
const last = {};
const plotSvgCache = {};
const debounce = (f, d) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), d) } };
const autoFix = s => s.replaceAll('^', '**').replace(/(\d)([a-zA-Z])/g, '$1*$2').replace(/([xy])\(/g, '$1*(').replace(/\)\(/g, ')*(').replace(/\)([a-zA-Z])/g, ')*$1').replace(/(\d)\(/g, '$1*(');
const hasMissingStar = s => /(\d[a-zA-Z]|\d\(|[xy]\(|\)[a-zA-Z0-9(])/.test(s);

// Convert sympy-style expression to function-plot compatible expression
const toPlotExpr = s => {
    if (!s || !s.trim()) return '';
    let t = s.trim();
    if (t.includes('=')) t = t.split('=').pop().trim();
    t = autoFix(t);
    t = t.replaceAll('**', '^');
    t = t.replace(/\bAbs\b/g, 'abs').replace(/\bABS\b/g, 'abs');
    t = t.replace(/\bln\b/g, 'log');
    t = t.replace(/\bE\b/g, 'e');
    return t;
};

// ===== TABS =====
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
        // Fade out current card
        document.querySelectorAll('.card[id^="form-"]').forEach(c => {
            c.classList.add('hidden');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        const tb = tab.dataset.tab;
        const card = $('form-' + tb);
        card.classList.remove('hidden');
        card.classList.add('card-enter');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => card.classList.remove('card-enter'));
        });
        try { renderHistory(tb) } catch (e) { }
        if (tb === 'grafik') initGrafik();
    });
});

// ===== FILL HELPERS =====
function fillField(id, v) { const el = $(id); if (!el) return; el.value = v; el.dispatchEvent(new Event('input')); el.focus(); }
function fillTurunan(v) { fillField('turunan-fungsi', v); }
function fillIntegral(v) { fillField('integral-fungsi', v); }
function fillLimit(v) { fillField('limit-fungsi', v); }

const fillActive = s => {
    const a = document.querySelector('.tab.active')?.dataset.tab || 'turunan';
    if (a === 'grafik') {
        const inputs = document.querySelectorAll('#grafik-list .grafik-input');
        let e = document.activeElement && document.activeElement.classList.contains('grafik-input') ? document.activeElement : (inputs[inputs.length - 1] || null);
        if (!e) { addGrafikRow(s, true); saveGrafikState(); renderGrafik(); return; }
        const i = e.selectionStart || e.value.length, b = e.value.slice(0, i), c = e.value.slice(e.selectionEnd || i), n = b && /[0-9xy\)]$/.test(b) && /^[a-zA-Z]/.test(s) ? '*' : '';
        e.value = b + n + s + c; e.focus(); e.setSelectionRange(i + s.length + (n ? 1 : 0), i + s.length + (n ? 1 : 0)); e.dispatchEvent(new Event('input'));
        saveGrafikState(); renderGrafik(); return;
    }
    const m = { turunan: 'turunan-fungsi', integral: 'integral-fungsi', limit: 'limit-fungsi' };
    const e = $(m[a]); if (!e) return;
    const i = e.selectionStart || e.value.length, b = e.value.slice(0, i), c = e.value.slice(e.selectionEnd || i), n = b && /[0-9xy\)]$/.test(b) && /^[a-zA-Z]/.test(s) ? '*' : '';
    e.value = b + n + s + c; e.focus(); e.setSelectionRange(i + s.length + (n ? 1 : 0), i + s.length + (n ? 1 : 0)); e.dispatchEvent(new Event('input'));
};

// ===== RENDER =====
function renderLatex(id, latex, isError) {
    const el = $(id); el.style.display = 'block';
    el.classList.remove('justify-center');
    if (isError) {
        el.innerHTML = '<div class="error-msg"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>' + latex + '</div>';
    } else {
        el.innerHTML = '';
        try { katex.render(latex, el, { throwOnError: false, displayMode: true }); } catch (e) { el.textContent = latex; }
    }
}

const showPlot = (tab, base64) => {
    const wrap = $('plot-' + tab);
    const img = $('plot-' + tab + '-img');
    if (wrap && img && base64) {
        img.src = 'data:image/png;base64,' + base64;
        wrap.classList.remove('hidden');
    }
};

const hidePlot = tab => {
    const plotEl = $('plot-' + tab);
    if (plotEl) plotEl.classList.add('hidden');
};

function renderMultiLine(id, lines) {
    const el = $(id); el.style.display = 'block'; el.innerHTML = '';
    el.classList.remove('justify-center');
    const frag = document.createDocumentFragment();
    lines.forEach(latex => {
        const d = document.createElement('div'); d.className = 'result-line';
        try { katex.render(latex, d, { throwOnError: false, displayMode: true }); } catch (e) { d.textContent = latex; }
        frag.appendChild(d);
    });
    el.appendChild(frag);
}

const setLoading = (btn, loading) => {
    if (loading) {
        btn.dataset.text = btn.innerHTML;
        btn.innerHTML = '<span class="spinner"></span> Menghitung...';
        btn.disabled = true;
    } else {
        btn.innerHTML = btn.dataset.text || 'Hitung';
        btn.disabled = false;
    }
};

// ===== VALIDATION =====
function showValid(tab, msg, fix) {
    const el = $('valid-' + tab); if (!msg) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.classList.remove('hidden');
    el.innerHTML = '<div class="valid-hint"><span>' + msg + '</span>' + (fix ? '<button onclick="autoFixAndFocus(\'' + tab + '\')" class="fix-btn">Fix → ' + fix + '</button>' : '') + '</div>';
}

function autoFixAndFocus(tab) {
    const map = { turunan: 'turunan-fungsi', integral: 'integral-fungsi', limit: 'limit-fungsi' };
    const id = map[tab], el = $(id), fixed = autoFix(el.value);
    el.value = fixed; el.dispatchEvent(new Event('input')); el.focus(); showValid(tab, '', '');
}

const bindValid = (inputId, tab) => {
    const el = $(inputId); if (!el) return;
    el.addEventListener('input', debounce(() => {
        const v = el.value.trim(); if (!v) { showValid(tab, '', ''); return; }
        if (hasMissingStar(v)) { const f = autoFix(v); showValid(tab, 'Terlihat <code>' + v + '</code> — mungkin maksud <code>' + f + '</code> ?', f); }
        else showValid(tab, '', '');
    }, 220));
};
bindValid('turunan-fungsi', 'turunan'); bindValid('integral-fungsi', 'integral'); bindValid('limit-fungsi', 'limit');

// ===== HISTORY =====
function loadH() { try { return JSON.parse(localStorage.getItem(LS_H) || '{}') } catch (e) { return {} } }
function saveH(o) { localStorage.setItem(LS_H, JSON.stringify(o)); }
function pushHistory(tab, input, latex) {
    if (!latex || latex.includes('Gagal')) return;
    const h = loadH(); h[tab] = h[tab] || []; h[tab].unshift({ input, latex, t: Date.now() }); h[tab] = h[tab].slice(0, 5); saveH(h); renderHistory(tab);
}

function renderHistory(tab) {
    const el = $('history-' + tab), h = (loadH()[tab] || []);
    if (!h.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.classList.remove('hidden');
    el.innerHTML = '<div class="history-label">Riwayat (' + h.length + ')</div>';
    const frag = document.createDocumentFragment();
    h.forEach((it, i) => {
        const b = document.createElement('button');
        b.className = 'history-item';
        b.innerHTML = '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">' + it.input + '</span><span style="flex-shrink:0;color:var(--accent)">↺</span>';
        b.title = 'Klik untuk isi lagi';
        b.addEventListener('click', () => { const map = { turunan: 'turunan-fungsi', integral: 'integral-fungsi', limit: 'limit-fungsi' }; $(map[tab]).value = it.input; $(map[tab]).dispatchEvent(new Event('input')); });
        frag.appendChild(b);
    });
    const clr = document.createElement('button');
    clr.className = 'history-clear';
    clr.textContent = 'Hapus riwayat';
    clr.addEventListener('click', () => { const h = loadH(); h[tab] = []; saveH(h); renderHistory(tab); });
    frag.appendChild(clr);
    el.appendChild(frag);
}

// ===== COPY / DOWNLOAD =====
function copyLatex(tab) {
    const latex = last[tab]; if (!latex) return;
    navigator.clipboard.writeText(latex).then(() => {
        const b = document.querySelector('#actions-' + tab + ' button');
        if (b) { const o = b.textContent; b.textContent = '✓ Copied!'; setTimeout(() => b.textContent = o, 1200); }
    }).catch(() => {
        const ta = document.createElement('textarea'); ta.value = latex; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    });
}

function toggleDownloadMenu(tab, forceClose) {
    const menu = $('menu-' + tab); if (!menu) return;
    if (forceClose) { menu.classList.add('hidden'); return; }
    const willShow = menu.classList.contains('hidden');
    document.querySelectorAll('[id^="menu-"]').forEach(m => m.classList.add('hidden'));
    if (willShow) menu.classList.remove('hidden');
}

document.addEventListener('click', e => {
    const isBtn = e.target.closest('[onclick*="toggleDownloadMenu"]');
    const isMenu = e.target.closest('[id^="menu-"]');
    if (!isBtn && !isMenu) document.querySelectorAll('[id^="menu-"]').forEach(m => m.classList.add('hidden'));
});

function downloadPlotAs(tab, fmt) {
    fmt = (fmt || 'png').toLowerCase();
    if (fmt === 'png') {
        const img = $('plot-' + tab + '-img');
        if (!img || !img.src || !img.src.includes('data:')) { alert('Belum ada grafik. Hitung dulu.'); return; }
        const a = document.createElement('a'); a.href = img.src; a.download = 'calcku-' + tab + '-' + Date.now() + '.png'; document.body.appendChild(a); a.click(); a.remove();
    } else if (fmt === 'svg') {
        const svg = plotSvgCache[tab];
        if (!svg) { alert('Belum ada grafik SVG. Hitung ulang.'); return; }
        const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'calcku-' + tab + '-' + Date.now() + '.svg'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}

// ===== INIT HISTORY =====
(() => {
    ['turunan', 'integral', 'limit'].forEach(renderHistory);
    ['turunan-fungsi', 'integral-fungsi', 'limit-fungsi'].forEach(id => { const el = $(id); if (el && el.value) el.dispatchEvent(new Event('input')); });
})();

// ===== API HELPER =====
async function calcApi({ endpoint, payload, tab, btnId, resultId, onSuccess }) {
    const btn = $(btnId);
    hidePlot(tab);
    setLoading(btn, true);

    // Show skeleton in result box
    const resultEl = $(resultId);
    if (resultEl) {
        resultEl.innerHTML = '<div class="skeleton-wrap"><div class="skeleton-line w80"></div><div class="skeleton-line w60"></div></div>';
    }

    try {
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.sukses) { onSuccess(data); }
        else renderLatex(resultId, data.error, true);
    } catch (e) { renderLatex(resultId, 'Gagal menghubungi server — cek koneksi', true); }
    finally { setLoading(btn, false); }
}

// ===== HITUNG TURUNAN =====
async function hitungTurunan() {
    const fungsi = $('turunan-fungsi').value.trim(); if (!fungsi) { $('turunan-fungsi').focus(); return; }
    const orde = $('turunan-orde').value, titik = $('turunan-titik').value.trim();
    await calcApi({
        endpoint: '/api/turunan', payload: { fungsi, orde, titik: titik || null },
        tab: 'turunan', btnId: 'btn-turunan', resultId: 'hasil-turunan',
        onSuccess: (data) => {
            const lines = [data.notasi + ' = ' + data.hasil];
            if (data.evaluasi) lines.push('f^{' + orde + '}(' + data.titik + ') = ' + data.evaluasi);
            renderMultiLine('hasil-turunan', lines); last['turunan'] = lines.join(' \\n ');
            if (data.plot) showPlot('turunan', data.plot);
            if (data.plot_svg) plotSvgCache['turunan'] = data.plot_svg;
            $('actions-turunan').classList.remove('hidden'); pushHistory('turunan', fungsi, last['turunan']);
        }
    });
}

// ===== HITUNG INTEGRAL =====
async function hitungIntegral() {
    const fungsi = $('integral-fungsi').value.trim(); if (!fungsi) { $('integral-fungsi').focus(); return; }
    const batas_bawah = $('integral-bawah').value.trim(), batas_atas = $('integral-atas').value.trim();
    await calcApi({
        endpoint: '/api/integral', payload: { fungsi, batas_bawah, batas_atas },
        tab: 'integral', btnId: 'btn-integral', resultId: 'hasil-integral',
        onSuccess: (data) => {
            const lines = []; if (data.tentu) lines.push(data.notasi + ' = ' + data.tentu); else lines.push(data.notasi + ' = ' + data.hasil + ' + C');
            renderMultiLine('hasil-integral', lines); last['integral'] = lines.join(' \\n ');
            if (data.plot) showPlot('integral', data.plot);
            if (data.plot_svg) plotSvgCache['integral'] = data.plot_svg;
            $('actions-integral').classList.remove('hidden'); pushHistory('integral', fungsi, last['integral']);
        }
    });
}

// ===== HITUNG LIMIT =====
async function hitungLimit() {
    const fungsi = $('limit-fungsi').value.trim(); if (!fungsi) { $('limit-fungsi').focus(); return; }
    const titik = $('limit-titik').value.trim(), arah = $('limit-arah').value;
    await calcApi({
        endpoint: '/api/limit', payload: { fungsi, titik, arah },
        tab: 'limit', btnId: 'btn-limit', resultId: 'hasil-limit',
        onSuccess: (data) => {
            const line = data.notasi + ' = ' + data.hasil;
            renderMultiLine('hasil-limit', [line]); last['limit'] = line;
            if (data.plot) showPlot('limit', data.plot);
            if (data.plot_svg) plotSvgCache['limit'] = data.plot_svg;
            $('actions-limit').classList.remove('hidden'); pushHistory('limit', fungsi, line);
        }
    });
}

// ===== GRAFIK =====
const LS_GRAFIK = 'calcku-grafik-v1';
const GRAFIK_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6'];
let grafikInited = false;

const getGrafikFns = () => Array.from(document.querySelectorAll('#grafik-list .grafik-input')).map(i => i.value.trim()).filter(Boolean);

const saveGrafikState = () => {
    try {
        const data = {
            fns: Array.from(document.querySelectorAll('#grafik-list .grafik-input')).map(i => i.value),
            xmin: $('grafik-xmin').value, xmax: $('grafik-xmax').value,
            ymin: $('grafik-ymin').value, ymax: $('grafik-ymax').value,
            grid: $('grafik-grid').checked
        };
        localStorage.setItem(LS_GRAFIK, JSON.stringify(data));
        const hash = encodeURIComponent(JSON.stringify(data.fns.filter(Boolean)));
        if (hash.length < 1800) history.replaceState(null, '', '#grafik=' + hash);
    } catch (e) { }
};

const loadGrafikState = () => {
    try {
        const m = location.hash.match(/#grafik=([^&]+)/);
        if (m) { const fns = JSON.parse(decodeURIComponent(m[1])); if (Array.isArray(fns) && fns.length) return { fns }; }
        const raw = localStorage.getItem(LS_GRAFIK);
        if (raw) return JSON.parse(raw);
    } catch (e) { }
    return null;
};

function addGrafikRow(val = '', focus = true) {
    const list = $('grafik-list');
    const idx = list.children.length;
    const color = GRAFIK_COLORS[idx % GRAFIK_COLORS.length];
    const row = document.createElement('div');
    row.className = 'grafik-row';
    row.innerHTML = '<span class="grafik-dot" style="background:' + color + '"></span>'
        + '<input type="text" placeholder="contoh: x^2, sin(x)/x" autocomplete="off" spellcheck="false" class="grafik-input" value="' + val.replace(/"/g, '&quot;') + '">'
        + '<button type="button" class="grafik-del" title="Hapus" aria-label="Hapus">×</button>';
    const inp = row.querySelector('input');
    const del = row.querySelector('button');
    const deb = debounce(() => { saveGrafikState(); renderGrafik(); }, 200);
    inp.addEventListener('input', deb);
    inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); renderGrafik(); saveGrafikState(); }
        if (e.key === 'Escape') inp.blur();
    });
    del.addEventListener('click', () => {
        row.remove();
        document.querySelectorAll('#grafik-list .grafik-dot').forEach((d, i) => { d.style.background = GRAFIK_COLORS[i % GRAFIK_COLORS.length]; });
        if (!list.children.length) addGrafikRow('', true);
        saveGrafikState(); renderGrafik();
    });
    list.appendChild(row);
    if (focus) inp.focus();
    return row;
}

function addGrafikPreset(v) {
    const list = $('grafik-list');
    const inputs = list.querySelectorAll('.grafik-input');
    if (inputs.length && !inputs[inputs.length - 1].value.trim()) {
        inputs[inputs.length - 1].value = v;
        inputs[inputs.length - 1].dispatchEvent(new Event('input'));
        inputs[inputs.length - 1].focus();
    } else { addGrafikRow(v, true); }
    saveGrafikState(); renderGrafik();
}

function clearGrafikError() { const e = $('grafik-error'); e.classList.add('hidden'); e.textContent = ''; }
function showGrafikError(msg) { const e = $('grafik-error'); e.textContent = msg; e.classList.remove('hidden'); }

const renderGrafik = debounce(() => {
    const wrap = $('grafik-canvas'), empty = $('grafik-empty');
    const inputs = document.querySelectorAll('#grafik-list .grafik-input');
    const rawFns = Array.from(inputs).map(i => i.value.trim());
    const fns = rawFns.map(toPlotExpr).filter(Boolean);
    const xmin = parseFloat($('grafik-xmin').value), xmax = parseFloat($('grafik-xmax').value);
    const ymin = parseFloat($('grafik-ymin').value), ymax = parseFloat($('grafik-ymax').value);
    const xDomain = [isFinite(xmin) ? xmin : -10, isFinite(xmax) ? xmax : 10];
    const yDomain = [isFinite(ymin) ? ymin : -10, isFinite(ymax) ? ymax : 10];
    const withGrid = $('grafik-grid').checked;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (!fns.length) { wrap.innerHTML = ''; empty.classList.remove('hidden'); clearGrafikError(); return; }
    empty.classList.add('hidden'); clearGrafikError();
    const data = fns.map((fn, i) => ({ fn, color: GRAFIK_COLORS[i % GRAFIK_COLORS.length], graphType: 'polyline' }));
    try {
        if (typeof functionPlot === 'undefined') { showGrafikError('Library grafik belum termuat. Cek koneksi.'); return; }
        const w = wrap.parentElement.clientWidth || 600;
        wrap.innerHTML = '';
        functionPlot({
            target: '#grafik-canvas',
            width: w, height: Math.min(380, Math.max(260, window.innerWidth < 480 ? 280 : 380)),
            xAxis: { domain: xDomain },
            yAxis: { domain: yDomain },
            grid: withGrid,
            disableZoom: false,
            data,
            tip: { xLine: true, yLine: true },
        });
        const svg = wrap.querySelector('svg');
        if (svg) {
            const coords = $('grafik-coords');
            coords.classList.remove('hidden');
            svg.addEventListener('mousemove', e => {
                const rect = svg.getBoundingClientRect();
                const x = xDomain[0] + (e.clientX - rect.left) / rect.width * (xDomain[1] - xDomain[0]);
                const y = yDomain[1] - (e.clientY - rect.top) / rect.height * (yDomain[1] - yDomain[0]);
                coords.textContent = 'x: ' + x.toFixed(2) + '  y: ' + y.toFixed(2);
            });
            svg.addEventListener('mouseleave', () => { coords.textContent = 'drag · scroll zoom'; });
            coords.textContent = 'drag · scroll zoom';
        }
        saveGrafikState();
    } catch (err) { showGrafikError('Gagal menggambar: ' + (err.message || err)); }
}, 160);

function initGrafik() {
    if (grafikInited) { renderGrafik(); return; }
    grafikInited = true;
    const list = $('grafik-list'); list.innerHTML = '';
    const saved = loadGrafikState();
    if (saved && saved.fns && saved.fns.length) {
        saved.fns.forEach(v => addGrafikRow(v, false));
        if (saved.xmin !== undefined) $('grafik-xmin').value = saved.xmin;
        if (saved.xmax !== undefined) $('grafik-xmax').value = saved.xmax;
        if (saved.ymin !== undefined) $('grafik-ymin').value = saved.ymin;
        if (saved.ymax !== undefined) $('grafik-ymax').value = saved.ymax;
        if (saved.grid !== undefined) $('grafik-grid').checked = !!saved.grid;
    }
    if (!list.children.length) { addGrafikRow('x^2', false); addGrafikRow('sin(x)', false); }
    ['grafik-xmin', 'grafik-xmax', 'grafik-ymin', 'grafik-ymax'].forEach(id => {
        $(id).addEventListener('input', debounce(() => { saveGrafikState(); renderGrafik(); }, 300));
    });
    $('grafik-grid').addEventListener('change', () => { saveGrafikState(); renderGrafik(); });
    try {
        const ro = new ResizeObserver(debounce(() => renderGrafik(), 200));
        ro.observe($('grafik-canvas-wrap'));
    } catch (e) { window.addEventListener('resize', debounce(() => renderGrafik(), 300)); }
    renderGrafik();
}

function resetGrafikView() {
    $('grafik-xmin').value = -10; $('grafik-xmax').value = 10;
    $('grafik-ymin').value = -10; $('grafik-ymax').value = 10;
    $('grafik-grid').checked = true;
    saveGrafikState(); renderGrafik();
}

function shareGrafik() {
    const fns = getGrafikFns(); if (!fns.length) { alert('Tambah fungsi dulu.'); return; }
    const url = location.href;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => {
            const b = document.querySelector('#form-grafik button[onclick="shareGrafik()"]');
            const old = b.textContent; b.textContent = '✓ Copied!'; setTimeout(() => b.textContent = old, 1200);
        });
    } else { prompt('Copy URL:', url); }
}

function _getGrafikSvgString() {
    const wrap = $('grafik-canvas'), svg = wrap.querySelector('svg');
    if (!svg) return null;
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    const rectB = svg.getBoundingClientRect();
    const wAttr = clone.getAttribute('width'), hAttr = clone.getAttribute('height');
    const w = wAttr ? parseFloat(wAttr) : (rectB.width || wrap.parentElement.clientWidth || 700);
    const h = hAttr ? parseFloat(hAttr) : (rectB.height || 380);
    clone.setAttribute('width', w); clone.setAttribute('height', h);
    clone.setAttribute('viewBox', clone.getAttribute('viewBox') || `0 0 ${w} ${h}`);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const bg = isDark ? '#1e293b' : '#f8f9fa';
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '0'); rect.setAttribute('y', '0');
    rect.setAttribute('width', w); rect.setAttribute('height', h); rect.setAttribute('fill', bg);
    clone.insertBefore(rect, clone.firstChild);
    return { str: new XMLSerializer().serializeToString(clone), svg, w, h };
}

function downloadGrafikAs(fmt) {
    fmt = (fmt || 'svg').toLowerCase();
    const data = _getGrafikSvgString();
    if (!data) { alert('Belum ada grafik. Tambah fungsi dulu.'); return; }
    if (fmt === 'svg') {
        const blob = new Blob([data.str], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'calcku-grafik-' + Date.now() + '.svg';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else if (fmt === 'png') {
        let svg64;
        try { svg64 = btoa(unescape(encodeURIComponent(data.str))); } catch (e) {
            const blob = new Blob([data.str], { type: 'image/svg+xml;charset=utf-8' });
            _renderSvgToPng(URL.createObjectURL(blob), data, true); return;
        }
        _renderSvgToPng('data:image/svg+xml;base64,' + svg64, data, false);
    }
}

function _renderSvgToPng(src, data, isBlob) {
    const img = new Image();
    img.onload = function () {
        try {
            const w = Math.round(data.w) || 800, h = Math.round(data.h) || 380;
            const scale = Math.min(2, window.devicePixelRatio || 2);
            const canvas = document.createElement('canvas');
            canvas.width = w * scale; canvas.height = h * scale;
            const ctx = canvas.getContext('2d');
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            ctx.fillStyle = isDark ? '#1e293b' : '#f8f9fa';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            if (isBlob) URL.revokeObjectURL(src);
            if (canvas.toBlob) {
                canvas.toBlob(pngBlob => {
                    if (!pngBlob) { alert('Gagal konversi PNG'); return; }
                    const pngUrl = URL.createObjectURL(pngBlob);
                    const a = document.createElement('a'); a.href = pngUrl; a.download = 'calcku-grafik-' + Date.now() + '.png';
                    document.body.appendChild(a); a.click(); a.remove();
                    setTimeout(() => URL.revokeObjectURL(pngUrl), 800);
                }, 'image/png');
            } else {
                const pngUrl = canvas.toDataURL('image/png');
                const a = document.createElement('a'); a.href = pngUrl; a.download = 'calcku-grafik-' + Date.now() + '.png';
                document.body.appendChild(a); a.click(); a.remove();
            }
        } catch (err) { if (isBlob) URL.revokeObjectURL(src); alert('Gagal render PNG: ' + (err.message || err)); }
    };
    img.onerror = function (e) { if (isBlob) URL.revokeObjectURL(src); alert('Gagal konversi PNG — coba download SVG.'); };
    img.src = src;
}

// ===== PANDUAN =====
function togglePanduan() {
    const el = $('panduan');
    const txt = $('panduan-toggle-text');
    const isHidden = el.classList.toggle('hidden');
    if (txt) txt.innerHTML = (isHidden ? 'Buka' : 'Tutup') + ' <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="transform:rotate(' + (isHidden ? '0' : '180') + 'deg);transition:transform 0.2s"><path d="M6 9l6 6 6-6"/></svg>';
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

// ===== ENTER KEY =====
document.querySelectorAll('.card input').forEach(i => {
    i.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const card = e.target.closest('.card');
            const btn = card && card.querySelector('.btn-primary');
            if (btn) btn.click();
        }
    });
});
if ($('limit-arah')) $('limit-arah').addEventListener('keydown', e => { if (e.key === 'Enter') hitungLimit(); });

// ===== HERO ANIMATION =====
(function animateHeroFormulas() {
    const track = $('hero-formulas-track');
    if (!track) return;
    const formulas = [
        '\\frac{d}{dx} x^n = nx^{n-1}',
        '\\int x^n\\,dx = \\frac{x^{n+1}}{n+1}+C',
        '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1',
        'e^{i\\pi} + 1 = 0',
        '\\frac{d}{dx} e^x = e^x',
        '\\int_0^\\infty e^{-x^2}dx = \\frac{\\sqrt{\\pi}}{2}',
        '\\frac{d}{dx} \\ln x = \\frac{1}{x}',
        '\\sum_{n=0}^{\\infty} \\frac{x^n}{n!} = e^x',
    ];
    // Duplicate for seamless loop
    const allFormulas = [...formulas, ...formulas];
    allFormulas.forEach(f => {
        const span = document.createElement('span');
        span.className = 'hero-formula-item';
        try { katex.render(f, span, { throwOnError: false, displayMode: false }); }
        catch (e) { span.textContent = f; }
        track.appendChild(span);
    });
})();

// ===== AUTO INIT =====
if (location.hash.includes('grafik=')) {
    setTimeout(() => { document.querySelector('[data-tab="grafik"]')?.click(); }, 200);
}
