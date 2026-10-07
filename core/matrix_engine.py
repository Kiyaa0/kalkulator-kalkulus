"""
core/matrix_engine.py
Mesin matriks lengkap:
- Operasi aritmatika (Tambah, Kurang, Kali, Bagi)
- Sifat matriks (Invers, Determinan, Transpose, Skalar)
- Eliminasi Gauss & Gauss-Jordan (REF & RREF)
- Analisis SPL (Solusi Tunggal, Tak Ada Solusi, Tak Berhingga Banyak Solusi)
- Operasi Baris Elementer (OBE) interaktif dengan rincian perhitungan per kolom
"""
import sympy as sp

from core.config import _BLOCKED_KEYWORDS
from core.parser import safe_parse_expr


def _is_negative(val):
    try:
        return bool(val < 0)
    except Exception:
        return False


def _is_zero(val):
    try:
        return bool(sp.simplify(val) == 0)
    except Exception:
        return False


def _fmt_term(val):
    """Format nilai skalar atau elemen matriks, memberi kurung jika bernilai negatif."""
    return f'({sp.latex(val)})' if _is_negative(val) else sp.latex(val)


def _require_square(M, name, op_label="Operasi ini"):
    """Validasi ordo matriks persegi (n×n) untuk operasi determinan, invers, dan pembagian."""
    r, c = M.shape
    if r != c:
        raise ValueError(f'{op_label} mensyaratkan matriks persegi (ordo n×n). Saat ini Matriks {name} berukuran {r}×{c}.')


def _parse_row_index(params, key, max_rows, label):
    """Membaca dan memvalidasi indeks baris 1-indexed untuk Operasi Baris Elementer (OBE)."""
    try:
        idx = int(params.get(key, 1)) - 1
    except Exception:
        raise ValueError(f'Nomor {label} ({key}) harus berupa bilangan bulat.')
    if not (0 <= idx < max_rows):
        raise ValueError(f'Nomor {label} harus antara 1 dan {max_rows}.')
    return idx


def _combine_augmented(A, B, nameA, nameB):
    """Menggabungkan dua matriks secara horizontal (augmented) dengan validasi kesesuaian baris."""
    rA, cA = A.shape
    rB, cB = B.shape
    if rA != rB:
        raise ValueError(f'Ukuran baris tidak cocok! Matriks {nameA} ({rA} baris) dan Matriks {nameB} ({rB} baris) harus memiliki jumlah baris yang sama.')
    return sp.Matrix.hstack(A, B), cA


def _make_matrix_result(op, notasi, matrix_or_val, steps, is_augmented=False, split_col=None, **extra):
    """Format response JSON terpadu untuk semua operasi matriks (mengeliminasi duplikasi return dict)."""
    if isinstance(matrix_or_val, sp.Matrix):
        lat = _matrix_to_latex(matrix_or_val, split_col=split_col if is_augmented else None)
        grid = _matrix_to_list(matrix_or_val)
        rows, cols = matrix_or_val.shape
    else:
        lat = sp.latex(matrix_or_val)
        grid = [[str(matrix_or_val)]]
        rows, cols = 1, 1

    res = {
        'sukses': True,
        'operasi': op,
        'notasi': notasi,
        'hasil_latex': lat,
        'hasil_grid': grid,
        'baris': rows,
        'kolom': cols,
        'langkah': steps
    }
    if is_augmented:
        res['is_augmented'] = True
        res['split_col'] = split_col
    res.update(extra)
    return res


def _parse_matrix_cell(val):
    """Mengurai sel matriks menjadi objek numerik/pecahan SymPy yang toleran terhadap format pengguna."""
    if val is None:
        return sp.Integer(0)
    s = str(val).strip()
    if not s:
        return sp.Integer(0)
    if len(s) > 50:
        raise ValueError('Nilai sel terlalu panjang (maksimal 50 karakter)')

    low = s.lower()
    for kw in _BLOCKED_KEYWORDS:
        if kw in low:
            raise ValueError(f'Karakter/kata kunci tidak diizinkan: {kw}')

    # Cek pecahan eksplisit p/q
    if '/' in s:
        parts = s.split('/')
        if len(parts) == 2:
            try:
                num = sp.Integer(parts[0].strip().replace(',', '.'))
                den = sp.Integer(parts[1].strip().replace(',', '.'))
                if den == 0:
                    raise ValueError('Pecahan tidak valid: pembagian dengan nol')
                return sp.Rational(num, den)
            except ValueError as ve:
                if 'pembagian dengan nol' in str(ve):
                    raise
            except Exception:
                pass

    expr = safe_parse_expr(s)
    if expr is None:
        raise ValueError(f'Nilai sel "{s}" tidak valid')
    return expr


def _matrix_from_json(grid, name='Matriks'):
    """Mengonversi 2D list JSON ke matriks SymPy dengan validasi ordo."""
    if not grid or not isinstance(grid, list):
        raise ValueError(f'Data {name} tidak boleh kosong')
    num_rows = len(grid)
    if num_rows < 1 or num_rows > 8:
        raise ValueError(f'Jumlah baris {name} harus antara 1 dan 8')
    if not isinstance(grid[0], list):
        raise ValueError(f'Format baris {name} tidak valid')
    num_cols = len(grid[0])
    if num_cols < 1 or num_cols > 8:
        raise ValueError(f'Jumlah kolom {name} harus antara 1 dan 8')

    rows = []
    has_symbols = False
    for r_idx, r in enumerate(grid):
        if not isinstance(r, list) or len(r) != num_cols:
            raise ValueError(f'Baris ke-{r_idx+1} pada {name} memiliki jumlah kolom yang tidak konsisten')
        row_cells = []
        for c in r:
            parsed = _parse_matrix_cell(c)
            if hasattr(parsed, 'free_symbols') and parsed.free_symbols:
                has_symbols = True
            row_cells.append(parsed)
        rows.append(row_cells)

    # karena determinan/invers simbolik di atas 3x3 memiliki kompleksitas O(n!) yang dapat membekukan server.
    if has_symbols and (num_rows > 3 or num_cols > 3):
        raise ValueError(
            f'Matriks simbolik (berisi variabel aljabar) hanya didukung hingga ordo maksimal 3x3 demi kestabilan server. '
            f'Untuk ordo {num_rows}x{num_cols}, gunakan angka atau pecahan numerik.'
        )

    return sp.Matrix(rows)


def _matrix_to_list(M):
    """Mengonversi matriks SymPy ke list 2D string untuk dikirim via JSON."""
    r, c = M.shape
    return [[str(M[i, j]) for j in range(c)] for i in range(r)]


def _matrix_to_latex(M, split_col=None):
    """Mengonversi matriks SymPy ke LaTeX. Mendukung separator vertikal untuk matriks augmented."""
    r, c = M.shape
    if split_col is not None and 0 < split_col < c:
        col_fmt = 'c' * split_col + '|' + 'c' * (c - split_col)
        rows_latex = [' & '.join([sp.latex(M[i, j]) for j in range(c)]) for i in range(r)]
        inner = ' \\\\ '.join(rows_latex)
        return f'\\left[\\begin{{array}}{{{col_fmt}}} {inner} \\end{{array}}\\right]'
    return sp.latex(M)


def _koef_latex(k):
    """Format koefisien untuk notasi OBE."""
    if k == 1:
        return ''
    if k == -1:
        return '-'
    s = sp.latex(k)
    return f'\\left({s}\\right)' if isinstance(k, sp.Add) else s


def _obe_swap(i, j):
    return f'R_{{{i+1}}} \\leftrightarrow R_{{{j+1}}}'


def _obe_skala(i, k):
    return f'R_{{{i+1}}} \\to {_koef_latex(k)}R_{{{i+1}}}'


def _obe_tambah(target, sumber, f):
    if _is_negative(f):
        tanda, koef = '+', -f
    else:
        tanda, koef = '-', f
    return f'R_{{{target+1}}} \\to R_{{{target+1}}} {tanda} {_koef_latex(koef)}R_{{{sumber+1}}}'


def _calc_row_scale_items(old_row, k, new_row):
    k_str = _fmt_term(k)
    return [
        f'\\text{{Kolom }} {j+1}: {k_str} \\times {_fmt_term(old_row[j])} = {sp.latex(new_row[j])}'
        for j in range(len(old_row))
    ]


def _calc_row_elim_items(target_old, source_row, f, target_new):
    is_neg = _is_negative(f)
    f_str = sp.latex(-f if is_neg else f)
    op_char = '+' if is_neg else '-'
    return [
        f'\\text{{Kolom }} {j+1}: {_fmt_term(target_old[j])} {op_char} ({f_str} \\times {_fmt_term(source_row[j])}) = {sp.latex(target_new[j])}'
        for j in range(len(target_old))
    ]


def _analyze_spl(M, split_col=None):
    """
    Menganalisis solusi Sistem Persamaan Linear (SPL) dari matriks augmented [A|b] hasil RREF.
    Mengidentifikasi: Solusi Tunggal, Tidak Ada Solusi (Inkonsisten), atau Tak Hingga Banyak Solusi.
    """
    m, n = M.shape
    if split_col is None:
        split_col = n - 1
    n_vars = split_col
    var_names = ['x', 'y', 'z', 'w'] if n_vars <= 4 else [f'x_{{{i+1}}}' for i in range(n_vars)]

    # 1. Cek inkonsistensi (0 = c dengan c != 0)
    for r in range(m):
        all_zero = all(_is_zero(M[r, c]) for c in range(split_col))
        const_val = M[r, split_col]
        if all_zero and not _is_zero(const_val):
            return {
                'status': 'tidak_ada_solusi',
                'judul': 'Tidak Ada Solusi (Sistem Inkonsisten)',
                'teks': f'Pada baris ke-{r+1}, semua koefisien variabel bernilai 0 namun konstanta bernilai {sp.latex(const_val)}, menghasilkan persamaan kontradiktif 0 = {sp.latex(const_val)}. Oleh karena itu sistem persamaan linear ini tidak memiliki solusi.',
                'solusi': []
            }

    # 2. Cari kolom pivot
    pivot_cols = []
    pivot_to_row = {}
    for r in range(m):
        for c in range(split_col):
            if not _is_zero(M[r, c]):
                pivot_cols.append(c)
                pivot_to_row[c] = r
                break

    free_cols = [c for c in range(split_col) if c not in pivot_cols]

    if not free_cols:
        sol_list = []
        for c in range(n_vars):
            r = pivot_to_row.get(c)
            val = M[r, split_col] if r is not None else 0
            sol_list.append(f'{var_names[c]} = {sp.latex(val)}')
        return {
            'status': 'solusi_tunggal',
            'judul': 'Solusi Tunggal (Unik)',
            'teks': f'Setiap variabel memiliki 1 utama tanpa variabel bebas. Rank matriks koefisien ({len(pivot_cols)}) sama dengan jumlah variabel ({n_vars}). Sistem memiliki tepat 1 penyelesaian pasti.',
            'solusi': sol_list
        }
    else:
        param_symbols = [sp.Symbol(name) for name in ['t', 's', 'u', 'v', 'p', 'q']]
        free_map = {}
        for idx, fc in enumerate(free_cols):
            free_map[fc] = param_symbols[idx % len(param_symbols)]

        sol_list = []
        for c in range(n_vars):
            if c in free_cols:
                p_sym = free_map[c]
                sol_list.append(f'{var_names[c]} = {sp.latex(p_sym)} \\quad ({sp.latex(p_sym)} \\in \\mathbb{{R}})')
            else:
                r = pivot_to_row[c]
                expr = M[r, split_col]
                for fc in free_cols:
                    coeff = M[r, fc]
                    if not _is_zero(coeff):
                        expr -= coeff * free_map[fc]
                expr = sp.simplify(expr)
                sol_list.append(f'{var_names[c]} = {sp.latex(expr)}')

        free_names_str = ', '.join([str(free_map[fc]) for fc in free_cols])
        return {
            'status': 'banyak_solusi',
            'judul': 'Tak Hingga Banyak Solusi (Parametrik)',
            'teks': f'Terdapat {len(free_cols)} variabel bebas dengan parameter riil ({free_names_str}). Himpunan penyelesaian dapat dinyatakan dalam bentuk parametrik berikut:',
            'solusi': sol_list
        }


def _gauss_proses(A, nameA, tereduksi=False, is_augmented=False, split_col=None):
    """
    Eliminasi Gauss (REF) atau Gauss-Jordan (RREF) langkah demi langkah.
    """
    M = A.copy()
    m, n = M.shape
    if is_augmented and split_col is None:
        split_col = n - 1

    if tereduksi:
        nama_metode = 'Gauss-Jordan (Eselon Baris Tereduksi / RREF)'
        syarat = ('(1) 1 Utama: Elemen tak-nol pertama tiap baris adalah 1. '
                  '(2) Pola Tangga: 1 utama baris bawah terletak lebih kanan. '
                  '(3) Baris Nol: Berada paling bawah. '
                  '(4) Kolom Bersih: Semua elemen di atas dan bawah 1 utama adalah 0.')
    else:
        nama_metode = 'Gauss (Eselon Baris / REF)'
        syarat = ('(1) 1 Utama: Elemen tak-nol pertama tiap baris adalah 1. '
                  '(2) Pola Tangga: 1 utama baris bawah terletak lebih kanan. '
                  '(3) Baris Nol: Berada paling bawah. '
                  '(4) Segitiga Bawah Bersih: Semua elemen di bawah 1 utama adalah 0.')

    latex_awal = _matrix_to_latex(M, split_col=split_col if is_augmented else None)
    steps = [
        {'judul': '1. Matriks Awal', 'latex': f'{nameA} = {latex_awal}'},
        {'judul': f'2. Panduan Metode {nama_metode}',
         'teks': f'Gunakan Operasi Baris Elementer (OBE) untuk mengubah matriks: {syarat}'}
    ]

    def catat(judul, teks, notasi, items=None):
        lat = _matrix_to_latex(M, split_col=split_col if is_augmented else None)
        step_obj = {
            'judul': f'{len(steps)+1}. {judul}',
            'teks': teks,
            'latex': f'{notasi} \\quad \\Longrightarrow \\quad {lat}'
        }
        if items:
            step_obj['items'] = items
        steps.append(step_obj)

    pivots = []
    pivot_row = 0
    col_limit = split_col if (is_augmented and split_col is not None) else n

    for col in range(col_limit):
        if pivot_row >= m:
            break

        cari = None
        for r in range(pivot_row, m):
            if not _is_zero(M[r, col]):
                cari = r
                break
        if cari is None:
            continue

        if cari != pivot_row:
            M.row_swap(pivot_row, cari)
            swap_items = []
            for c_idx in range(n):
                swap_items.append(f'\\text{{Kolom }} {c_idx+1}: R_{{{pivot_row+1}}} = {sp.latex(M[pivot_row, c_idx])}, \\quad R_{{{cari+1}}} = {sp.latex(M[cari, c_idx])}')
            catat(f'Kolom {col+1}: Tukar Baris',
                  f'Elemen baris {pivot_row+1} kolom {col+1} bernilai 0. Tukar baris {pivot_row+1} dengan baris {cari+1}.',
                  _obe_swap(pivot_row, cari),
                  items=swap_items)

        p = M[pivot_row, col]
        if not _is_zero(p - 1):
            k = sp.simplify(1 / p)
            old_row = [M[pivot_row, c_idx] for c_idx in range(n)]
            M[pivot_row, :] = (M[pivot_row, :] * k).applyfunc(sp.simplify)
            new_row = [M[pivot_row, c_idx] for c_idx in range(n)]
            scale_items = _calc_row_scale_items(old_row, k, new_row)
            catat(f'Kolom {col+1}: Buat 1 Utama',
                  f'Kalikan baris ke-{pivot_row+1} dengan k = {sp.latex(k)} agar elemen pivot menjadi 1.',
                  _obe_skala(pivot_row, k),
                  items=scale_items)

        if tereduksi:
            target_rows = [r for r in range(m) if r != pivot_row]
        else:
            target_rows = range(pivot_row + 1, m)

        for r in target_rows:
            f = M[r, col]
            if _is_zero(f):
                continue
            old_target = [M[r, c_idx] for c_idx in range(n)]
            source_row = [M[pivot_row, c_idx] for c_idx in range(n)]
            M[r, :] = (M[r, :] - f * M[pivot_row, :]).applyfunc(sp.simplify)
            new_target = [M[r, c_idx] for c_idx in range(n)]
            elim_items = _calc_row_elim_items(old_target, source_row, f, new_target)
            arah = 'atas' if r < pivot_row else 'bawah'
            catat(f'Kolom {col+1}: Nolkan Elemen di {arah.capitalize()}',
                  f'Nolkan elemen baris {r+1} kolom {col+1} dengan mengurangkan baris {r+1} menggunakan {sp.latex(f)} kali baris {pivot_row+1}.',
                  _obe_tambah(r, pivot_row, f),
                  items=elim_items)

        pivots.append((pivot_row, col))
        pivot_row += 1

    rank = len(pivots)
    latex_akhir = _matrix_to_latex(M, split_col=split_col if is_augmented else None)
    if len(steps) == 2:
        teks_akhir = f'Matriks {nameA} sudah memenuhi kriteria {"eselon tereduksi" if tereduksi else "eselon baris"}. '
    else:
        teks_akhir = 'Semua operasi baris telah selesai dilaksanakan. '
    teks_akhir += f'Ditemukan {rank} baris dengan 1 utama, sehingga rank({nameA}) = {rank}.'

    steps.append({
        'judul': f'{len(steps)+1}. Bentuk Akhir',
        'teks': teks_akhir,
        'latex': f'{nameA} \\sim {latex_akhir}'
    })

    spl_info = None
    if is_augmented:
        spl_info = _analyze_spl(M, split_col=split_col)

    op_code = 'spl_augmented' if is_augmented else ('eselon_tereduksi' if tereduksi else 'eselon')
    notasi = f'[{nameA}]' if is_augmented else f'\\operatorname{{{("rref" if tereduksi else "ref")}}}({nameA})'

    return _make_matrix_result(
        op=op_code,
        notasi=notasi,
        matrix_or_val=M,
        steps=steps,
        is_augmented=is_augmented,
        split_col=split_col,
        rank=rank,
        spl_info=spl_info
    )


def _matrix_op_tambah_kurang(A, B, nameA, nameB, op='tambah'):
    """Operasi penjumlahan atau pengurangan matriks dengan penjelasan langkah terpadu."""
    is_add = (op == 'tambah')
    op_sym = '+' if is_add else '-'
    op_name = 'penjumlahan' if is_add else 'pengurangan'
    rA, cA = A.shape
    rB, cB = B.shape
    if rA != rB or cA != cB:
        raise ValueError(f'Ukuran tidak cocok! {op_name.capitalize()} mensyaratkan kedua matriks berukuran sama persis. Matriks {nameA} berukuran {rA}×{cA}, sedangkan Matriks {nameB} berukuran {rB}×{cB}.')

    inter_rows = []
    for i in range(rA):
        row = []
        for j in range(cA):
            row.append(f'{sp.latex(A[i, j])} {op_sym} {_fmt_term(B[i, j])}')
        inter_rows.append(' & '.join(row))
    inter_latex = '\\begin{bmatrix}' + ' \\\\ '.join(inter_rows) + '\\end{bmatrix}'

    res = (A + B) if is_add else (A - B)
    action_verb = 'dijumlahkan' if is_add else 'dikurangkan'
    formula = 'a_{ij} + b_{ij}' if is_add else 'a_{ij} - b_{ij}'
    steps = [
        {'judul': '1. Periksa Ordo Matriks', 'teks': f'Kedua matriks berordo sama yaitu {rA} \\times {cA}. Syarat {op_name} terpenuhi.'},
        {'judul': f'2. Rumus {op_name.capitalize()}', 'teks': f'Setiap elemen pada posisi yang bersesuaian {action_verb}: c_{{ij}} = {formula}'},
        {'judul': f'3. Proses {op_name.capitalize()} Elemen', 'latex': f'{nameA} {op_sym} {nameB} = {inter_latex}'},
        {'judul': '4. Hasil Akhir', 'latex': f'{nameA} {op_sym} {nameB} = {sp.latex(res)}'}
    ]
    return _make_matrix_result(op, f"{nameA} {op_sym} {nameB}", res, steps)


def _matrix_op_kali(A, B, nameA, nameB):
    rA, cA = A.shape
    rB, cB = B.shape
    if cA != rB:
        raise ValueError(f'Ukuran tidak cocok untuk perkalian! Jumlah Kolom Matriks {nameA} ({cA}) harus sama dengan Jumlah Baris Matriks {nameB} ({rB}). (Syarat: perkalian matriks {rA}×{cA} dengan {rB}×{cB} hanya bisa jika {cA} = {rB}).')

    calc_items = []
    for i in range(rA):
        for j in range(cB):
            terms = []
            terms_val = []
            for k in range(cA):
                a_val, b_val = A[i, k], B[k, j]
                terms.append(f'{_fmt_term(a_val)} \\cdot {_fmt_term(b_val)}')
                terms_val.append(a_val * b_val)
            expr_str = ' + '.join(terms).replace('+ -', '- ')
            val_res = sum(terms_val)
            calc_items.append(f'c_{{{i+1}{j+1}}} = {expr_str} = {sp.latex(val_res)}')

    res = A * B
    steps = [
        {'judul': '1. Periksa Syarat Dimensi Perkalian', 'teks': f'Kolom matriks {nameA} ({cA}) sama dengan baris matriks {nameB} ({rB}). Perkalian dapat dilakukan dan menghasilkan matriks berordo {rA} \\times {cB}.'},
        {'judul': '2. Konsep Perkalian Matriks (Baris kali Kolom)', 'teks': 'Setiap elemen baris i pada matriks pertama dikalikan dengan kolom j pada matriks kedua lalu dijumlahkan: c_{ij} = \\sum_{k=1}^n a_{ik} \\cdot b_{kj}'},
        {'judul': '3. Rincian Perhitungan Setiap Elemen', 'items': calc_items},
        {'judul': '4. Hasil Akhir Perkalian', 'latex': f'{nameA} \\times {nameB} = {sp.latex(res)}'}
    ]
    return _make_matrix_result('kali', f"{nameA} \\times {nameB}", res, steps)


def _matrix_op_bagi(A, B, nameA, nameB):
    rA, cA = A.shape
    rB, cB = B.shape
    _require_square(B, nameB, f'Matriks pembagi ({nameB})')

    det_B = B.det()
    if det_B == 0:
        raise ValueError(f'Matriks pembagi ({nameB}) memiliki determinan = 0 (matriks singular). Matriks yang determinannya 0 tidak memiliki invers, sehingga operasi pembagian tidak terdefinisi.')

    if cA != rB:
        raise ValueError(f'Kolom Matriks {nameA} ({cA}) tidak sama dengan baris Matriks {nameB} ({rB}). Perkalian {nameA} \\times {nameB}^{{-1}} memerlukan Kolom {nameA} = Baris {nameB}.')

    det_latex = sp.latex(det_B)
    steps = [
        {'judul': '1. Konsep Pembagian Matriks', 'teks': f'Dalam aljabar linear, pembagian matriks {nameA} \\div {nameB} dihitung sebagai perkalian dengan invers matriks pembagi: {nameA} \\times {nameB}^{{-1}}.'}
    ]

    det_formula = f'({sp.latex(B[0,0])} \\cdot {sp.latex(B[1,1])}) - ({sp.latex(B[0,1])} \\cdot {sp.latex(B[1,0])}) = {det_latex}' if rB == 2 else f'{det_latex}'
    steps.append({
        'judul': f'2. Hitung Determinan Matriks Pembagi {nameB}',
        'teks': f'Determinan matriks {nameB} berordo {rB} \\times {cB}:',
        'latex': f'\\det({nameB}) = {det_formula} \\neq 0 \\quad (\\text{{Invers ada}})'
    })

    B_inv = B.inv()
    steps.append({
        'judul': f'3. Cari Invers Matriks {nameB}^{{-1}}',
        'teks': f'Rumus invers: {nameB}^{{-1}} = \\frac{{1}}{{\\det({nameB})}} \\operatorname{{adj}}({nameB})',
        'latex': f'{nameB}^{{-1}} = {sp.latex(B_inv)}'
    })

    res = A * B_inv
    steps.append({
        'judul': f'4. Kalikan {nameA} dengan {nameB}^{{-1}}',
        'latex': f'{nameA} \\times {nameB}^{{-1}} = {sp.latex(A)} \\times {sp.latex(B_inv)} = {sp.latex(res)}'
    })
    steps.append({
        'judul': '5. Hasil Akhir Pembagian',
        'latex': f'{nameA} \\div {nameB} = {sp.latex(res)}'
    })
    return _make_matrix_result('bagi', f"{nameA} \\div {nameB}", res, steps)


def _matrix_op_invers(A, nameA):
    _require_square(A, nameA, f'Mencari invers matriks {nameA}')
    det_A = A.det()
    if det_A == 0:
        raise ValueError(f'Matriks {nameA} memiliki determinan = 0 (matriks singular). Matriks singular tidak memiliki invers.')
    A_inv = A.inv()
    steps = [
        {'judul': '1. Periksa Syarat Invers', 'teks': f'Matriks {nameA} adalah matriks persegi {A.shape[0]} \\times {A.shape[1]}. Determinan \\det({nameA}) = {sp.latex(det_A)} \\neq 0, maka invers ada.'},
        {'judul': '2. Hasil Invers', 'latex': f'{nameA}^{{-1}} = {sp.latex(A_inv)}'}
    ]
    return _make_matrix_result('invers', f"{nameA}^{{-1}}", A_inv, steps)


def _matrix_op_determinan(A, nameA):
    _require_square(A, nameA, f'Determinan matriks {nameA}')
    det_A = A.det()
    steps = [
        {'judul': '1. Ordo Matriks', 'teks': f'Matriks {nameA} adalah matriks persegi {A.shape[0]} \\times {A.shape[1]}.'}
    ]
    if A.shape[0] == 2:
        steps.append({
            'judul': '2. Perhitungan Determinan (2×2)',
            'latex': f'\\det({nameA}) = ({sp.latex(A[0,0])} \\cdot {sp.latex(A[1,1])}) - ({sp.latex(A[0,1])} \\cdot {sp.latex(A[1,0])}) = {sp.latex(det_A)}'
        })
    else:
        steps.append({
            'judul': '2. Nilai Determinan',
            'latex': f'\\det({nameA}) = {sp.latex(det_A)}'
        })
    return _make_matrix_result('determinan', f"\\det({nameA})", det_A, steps)


def _matrix_op_transpose(A, nameA):
    A_T = A.T
    steps = [
        {'judul': '1. Konsep Transpose', 'teks': 'Mengubah baris menjadi kolom dan kolom menjadi baris: (A^T)_{ij} = A_{ji}'},
        {'judul': '2. Hasil Transpose', 'latex': f'{nameA}^T = {sp.latex(A_T)}'}
    ]
    return _make_matrix_result('transpose', f"{nameA}^T", A_T, steps)


def _matrix_op_skalar(A, nameA, skalar_val):
    k_val = _parse_matrix_cell(skalar_val)
    res = k_val * A
    steps = [
        {'judul': '1. Konsep Perkalian Skalar', 'teks': f'Setiap elemen dalam matriks dikalikan dengan skalar k = {sp.latex(k_val)}.'},
        {'judul': '2. Hasil Perkalian Skalar', 'latex': f'{sp.latex(k_val)} \\cdot {nameA} = {sp.latex(res)}'}
    ]
    return _make_matrix_result('skalar', f"{sp.latex(k_val)} \\cdot {nameA}", res, steps)


def _matrix_op_augmented(A, B, nameA, nameB):
    res, cA = _combine_augmented(A, B, nameA, nameB)
    res_latex = _matrix_to_latex(res, split_col=cA)
    steps = [
        {'judul': '1. Periksa Kesesuaian Baris', 'teks': f'Kedua matriks memiliki jumlah baris yang sama yaitu {A.shape[0]} baris.'},
        {'judul': '2. Hasil Penggabungan Matriks Augmented', 'latex': f'[{nameA} \\mid {nameB}] = {res_latex}'}
    ]
    return _make_matrix_result('augmented', f"[{nameA} \\mid {nameB}]", res, steps, is_augmented=True, split_col=cA)


def _matrix_op_spl(A, B=None, nameA='A', nameB='B'):
    if B is not None:
        M, split_col = _combine_augmented(A, B, nameA, nameB)
        nama_spl = f'{nameA} \\mid {nameB}'
    else:
        M = A
        rA, cA = A.shape
        if cA < 2:
            raise ValueError('Matriks augmented untuk SPL memerlukan minimal 2 kolom (variabel dan konstanta).')
        split_col = cA - 1
        nama_spl = nameA

    return _gauss_proses(M, f'[{nama_spl}]', tereduksi=True, is_augmented=True, split_col=split_col)


def _matrix_op_manual_obe(A, nameA, obe_params, is_augmented=False, split_col=None):
    if not obe_params:
        raise ValueError('Parameter operasi baris elementer (obe_params) tidak boleh kosong.')

    obe_tipe = str(obe_params.get('tipe', 'tukar')).strip().lower()
    m, n = A.shape
    res = A.copy()

    row_i = _parse_row_index(obe_params, 'row_i', m, 'baris target')
    k_val_raw = obe_params.get('k', '1')
    items = []

    if obe_tipe == 'tukar':
        row_j = _parse_row_index(obe_params, 'row_j', m, 'baris kedua')
        if row_i == row_j:
            raise ValueError('Baris yang ditukar harus dua baris yang berbeda.')

        res.row_swap(row_i, row_j)
        notasi = _obe_swap(row_i, row_j)
        teks = f'Tukar posisi seluruh elemen baris ke-{row_i+1} dengan baris ke-{row_j+1}.'
        items = [
            f'\\text{{Kolom }} {col+1}: R_{{{row_i+1}}} = {sp.latex(res[row_i, col])}, \\quad R_{{{row_j+1}}} = {sp.latex(res[row_j, col])}'
            for col in range(n)
        ]

    elif obe_tipe == 'skalar':
        k = _parse_matrix_cell(k_val_raw)
        if _is_zero(k):
            raise ValueError('Skalar pengali untuk operasi baris elementer tidak boleh 0 (k ≠ 0).')

        old_row = [res[row_i, c] for c in range(n)]
        res[row_i, :] = (res[row_i, :] * k).applyfunc(sp.simplify)
        new_row = [res[row_i, c] for c in range(n)]
        notasi = _obe_skala(row_i, k)
        teks = f'Kalikan setiap elemen pada baris ke-{row_i+1} dengan skalar k = {sp.latex(k)}.'
        items = _calc_row_scale_items(old_row, k, new_row)

    elif obe_tipe == 'tambah':
        row_j = _parse_row_index(obe_params, 'row_j', m, 'baris sumber')
        if row_i == row_j:
            raise ValueError('Baris target dan baris sumber harus berbeda untuk operasi penjumlahan baris.')

        k = _parse_matrix_cell(k_val_raw)
        if _is_zero(k):
            raise ValueError('Pengali skalar k tidak boleh 0.')

        old_target = [res[row_i, c] for c in range(n)]
        source_row = [res[row_j, c] for c in range(n)]
        res[row_i, :] = (res[row_i, :] + k * res[row_j, :]).applyfunc(sp.simplify)
        new_target = [res[row_i, c] for c in range(n)]

        notasi = _obe_tambah(row_i, row_j, -k)
        if _is_negative(k):
            teks = f'Kurangkan baris ke-{row_i+1} dengan {sp.latex(-k)} kali baris ke-{row_j+1}.'
        else:
            teks = f'Tambahkan baris ke-{row_i+1} dengan {sp.latex(k)} kali baris ke-{row_j+1}.'
        items = _calc_row_elim_items(old_target, source_row, -k, new_target)
    else:
        raise ValueError(f'Tipe operasi OBE "{obe_tipe}" tidak valid. Pilih "tukar", "skalar", atau "tambah".')

    lat_res = _matrix_to_latex(res, split_col=split_col if is_augmented else None)
    step = {
        'judul': f'1. Operasi Baris: {notasi}',
        'teks': teks,
        'latex': f'{nameA} \\xrightarrow{{{notasi}}} {lat_res}',
        'items': items
    }
    return _make_matrix_result('manual_obe', notasi, res, [step], is_augmented=is_augmented, split_col=split_col)


def calc_matrix_logic(op, A_grid, B_grid=None, nameA='A', nameB='B', skalar_val=1, obe_params=None, is_augmented=False, split_col=None):
    """Dispatcher utama kalkulator matriks."""
    A = _matrix_from_json(A_grid, f'Matriks {nameA}')

    if op in ('tambah', 'kurang', 'kali', 'bagi', 'augmented'):
        if not B_grid:
            raise ValueError(f'Matriks kedua ({nameB}) diperlukan untuk operasi {op}')
        B = _matrix_from_json(B_grid, f'Matriks {nameB}')
        if op in ('tambah', 'kurang'):
            return _matrix_op_tambah_kurang(A, B, nameA, nameB, op=op)
        elif op == 'kali':
            return _matrix_op_kali(A, B, nameA, nameB)
        elif op == 'bagi':
            return _matrix_op_bagi(A, B, nameA, nameB)
        elif op == 'augmented':
            return _matrix_op_augmented(A, B, nameA, nameB)

    elif op == 'invers':
        return _matrix_op_invers(A, nameA)
    elif op == 'determinan':
        return _matrix_op_determinan(A, nameA)
    elif op == 'transpose':
        return _matrix_op_transpose(A, nameA)
    elif op == 'skalar':
        return _matrix_op_skalar(A, nameA, skalar_val)
    elif op in ('eselon', 'ref', 'gauss'):
        return _gauss_proses(A, nameA, tereduksi=False, is_augmented=is_augmented, split_col=split_col)
    elif op in ('eselon_tereduksi', 'rref', 'gauss_jordan', 'gauss-jordan', 'gaussjordan'):
        return _gauss_proses(A, nameA, tereduksi=True, is_augmented=is_augmented, split_col=split_col)
    elif op in ('spl', 'spl_augmented', 'solusi_spl'):
        B = _matrix_from_json(B_grid, f'Matriks {nameB}') if B_grid else None
        return _matrix_op_spl(A, B, nameA, nameB)
    elif op in ('obe', 'manual_obe'):
        return _matrix_op_manual_obe(A, nameA, obe_params, is_augmented=is_augmented, split_col=split_col)
    else:
        raise ValueError(f'Operasi "{op}" tidak dikenali.')
