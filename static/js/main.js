document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.card').forEach(c => {
            if (!c.classList.contains('panduan')) c.classList.add('hidden');
        });
        tab.classList.add('active');
        document.getElementById('form-' + tab.dataset.tab).classList.remove('hidden');
    });
});

function renderLatex(elementId, latex, isError) {
    const el = document.getElementById(elementId);
    if (isError) {
        el.innerHTML = '<span class="error">' + latex + '</span>';
    } else {
        katex.render(latex, el, { throwOnError: false, displayMode: true });
    }
}

function showPlot(tab, b64) {
    const container = document.getElementById('plot-' + tab);
    const img = document.getElementById('plot-' + tab + '-img');
    img.src = 'data:image/png;base64,' + b64;
    container.classList.remove('hidden');
}

function hidePlot(tab) {
    document.getElementById('plot-' + tab).classList.add('hidden');
}

function renderMultiLine(elementId, lines) {
    const el = document.getElementById(elementId);
    el.innerHTML = '';
    lines.forEach(latex => {
        const div = document.createElement('div');
        div.className = 'result-line';
        katex.render(latex, div, { throwOnError: false, displayMode: true });
        el.appendChild(div);
    });
}

function setLoading(btn, loading) {
    if (loading) {
        btn.dataset.text = btn.textContent;
        btn.textContent = 'Menghitung...';
        btn.disabled = true;
    } else {
        btn.textContent = btn.dataset.text || 'Hitung';
        btn.disabled = false;
    }
}

async function hitungTurunan() {
    const fungsi = document.getElementById('turunan-fungsi').value.trim();
    if (!fungsi) return;
    const orde = document.getElementById('turunan-orde').value;
    const titik = document.getElementById('turunan-titik').value.trim();
    const btn = document.querySelector('#form-turunan .btn');
    hidePlot('turunan');
    setLoading(btn, true);
    try {
        const res = await fetch('/api/turunan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fungsi, orde, titik: titik || null })
        });
        const data = await res.json();
        if (data.sukses) {
            const lines = [data.notasi + ' = ' + data.hasil];
            if (data.evaluasi) {
                lines.push('f^{' + orde + '}(' + data.titik + ') = ' + data.evaluasi);
            }
            renderMultiLine('hasil-turunan', lines);
            if (data.plot) showPlot('turunan', data.plot);
        } else {
            renderLatex('hasil-turunan', data.error, true);
        }
    } catch (e) {
        renderLatex('hasil-turunan', 'Gagal menghubungi server', true);
    } finally {
        setLoading(btn, false);
    }
}

async function hitungIntegral() {
    const fungsi = document.getElementById('integral-fungsi').value.trim();
    if (!fungsi) return;
    const batas_bawah = document.getElementById('integral-bawah').value.trim();
    const batas_atas = document.getElementById('integral-atas').value.trim();
    const btn = document.querySelector('#form-integral .btn');
    hidePlot('integral');
    setLoading(btn, true);
    try {
        const res = await fetch('/api/integral', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fungsi, batas_bawah, batas_atas })
        });
        const data = await res.json();
        if (data.sukses) {
            const lines = [];
            if (data.tentu) {
                lines.push(data.notasi + ' = ' + data.tentu);
            } else {
                lines.push(data.notasi + ' = ' + data.hasil + ' + C');
            }
            renderMultiLine('hasil-integral', lines);
            if (data.plot) showPlot('integral', data.plot);
        } else {
            renderLatex('hasil-integral', data.error, true);
        }
    } catch (e) {
        renderLatex('hasil-integral', 'Gagal menghubungi server', true);
    } finally {
        setLoading(btn, false);
    }
}

async function hitungLimit() {
    const fungsi = document.getElementById('limit-fungsi').value.trim();
    if (!fungsi) return;
    const titik = document.getElementById('limit-titik').value.trim();
    const arah = document.getElementById('limit-arah').value;
    const btn = document.querySelector('#form-limit .btn');
    hidePlot('limit');
    setLoading(btn, true);
    try {
        const res = await fetch('/api/limit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fungsi, titik, arah })
        });
        const data = await res.json();
        if (data.sukses) {
            renderMultiLine('hasil-limit', [data.notasi + ' = ' + data.hasil]);
            if (data.plot) showPlot('limit', data.plot);
        } else {
            renderLatex('hasil-limit', data.error, true);
        }
    } catch (e) {
        renderLatex('hasil-limit', 'Gagal menghubungi server', true);
    } finally {
        setLoading(btn, false);
    }
}

function togglePanduan() {
    document.getElementById('panduan').classList.toggle('hidden');
}

document.querySelectorAll('.card').forEach(card => {
    card.querySelectorAll('input').forEach(input => {
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const btn = card.querySelector('.btn');
                if (btn) btn.click();
            }
        });
    });
});
