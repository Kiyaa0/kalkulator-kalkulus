"""
core/domain_analysis.py
Mesin analisis daerah asal alami (natural domain), syarat pembatas,
karakteristik fungsi (asimtot, titik potong, turunan, titik stasioner, simetri),
serta rekomendasi rentang grafik dan tabel nilai.
"""
import numpy as np
import sympy as sp
from sympy.calculus.util import continuous_domain, singularities

from core.parser import to_float


def _solve_ineq_annotation(ineq, var):
    """Membantu menyelesaikan pertidaksamaan dan menghasilkan anotasi LaTeX (misal: => x >= 2)."""
    try:
        sol = sp.solve(ineq, var)
        if sol and sol is not True and sol is not False:
            return f" \\implies {sp.latex(sol)}"
    except Exception:
        pass
    return ""


def _is_real_finite(val):
    """Mengecek apakah nilai simbolik/numerik adalah bilangan real dan berhingga."""
    return bool(getattr(val, 'is_real', False) and not getattr(val, 'is_infinite', True))


def _get_real_roots(expr, var):
    """Mencari solusi akar-akar real dari suatu persamaan aljabar."""
    try:
        sol = sp.solve(expr, var)
        return [r for r in sol if getattr(r, 'is_real', False)]
    except Exception:
        return []


def compute_natural_domain_and_analysis(f_expr, expr_str, var):
    """
    Menghitung daerah asal alami (natural domain), syarat-syarat pembatas,
    titik potong, asimtot, turunan pertama, rekomendasi rentang grafik, dan tabel nilai.
    """
    syarat_list = []
    var_name = str(var)

    # ---------------------------------------------------------
    # 1. ANALISIS SYARAT-SYARAT PEMBATAS ALJABAR
    # ---------------------------------------------------------
    # A. Penyebut pecahan tidak boleh nol
    try:
        num, den = sp.fraction(sp.together(f_expr))
        if den != 1 and den.has(var):
            real_roots = _get_real_roots(den, var)
            if real_roots:
                r_latex = ', '.join([sp.latex(r) for r in real_roots])
                syarat_list.append({
                    'jenis': 'Penyebut Tidak Boleh Nol',
                    'teks': f'Penyebut pecahan tidak boleh sama dengan nol: $${sp.latex(den)} \\neq 0 \\implies {var_name} \\neq {r_latex}$$'
                })
            else:
                syarat_list.append({
                    'jenis': 'Penyebut Tidak Boleh Nol',
                    'teks': f'Penyebut pecahan tidak boleh sama dengan nol: $${sp.latex(den)} \\neq 0$$'
                })
    except Exception:
        pass

    # B. Bentuk akar pangkat genap (radicand >= 0)
    try:
        for term in f_expr.atoms(sp.Pow):
            if term.exp.is_Rational and term.exp.q % 2 == 0 and term.exp.p > 0 and term.base.has(var):
                rad = term.base
                sol_note = _solve_ineq_annotation(rad >= 0, var)
                syarat_list.append({
                    'jenis': 'Bentuk Akar Pangkat Genap',
                    'teks': f'Bagian di dalam akar pangkat genap harus tak-negatif: $${sp.latex(rad)} \\ge 0{sol_note}$$'
                })
    except Exception:
        pass

    # C. Numerus Logaritma (arg > 0)
    try:
        for term in f_expr.atoms(sp.log):
            if term.args[0].has(var):
                arg = term.args[0]
                sol_note = _solve_ineq_annotation(arg > 0, var)
                syarat_list.append({
                    'jenis': 'Numerus Logaritma',
                    'teks': f'Numerus logaritma harus bernilai positif murni: $${sp.latex(arg)} > 0{sol_note}$$'
                })
    except Exception:
        pass

    # D. Invers Trigonometri (asin, acos: -1 <= arg <= 1)
    for fn_cls, fn_name in [(sp.asin, 'Invers Sinus (arcsin)'), (sp.acos, 'Invers Kosinus (arccos)')]:
        try:
            for term in f_expr.atoms(fn_cls):
                if term.args[0].has(var):
                    syarat_list.append({
                        'jenis': f'Domain {fn_name}',
                        'teks': f'Argumen {fn_cls.__name__} harus dalam rentang $[-1, 1]$: $$-1 \\le {sp.latex(term.args[0])} \\le 1$$'
                    })
        except Exception:
            pass

    # E. Tangen & Kotangen
    trig_asymp = [
        (sp.tan, 'Asimtot Tangen', 'tangen', '\\frac{\\pi}{2} + k\\pi'),
        (sp.cot, 'Asimtot Kotangen', 'kotangen', 'k\\pi')
    ]
    for trig_cls, title, name, asymp_expr in trig_asymp:
        if f_expr.has(trig_cls):
            syarat_list.append({
                'jenis': title,
                'teks': f'Fungsi {name} tidak terdefinisi pada ${asymp_expr}$: $${var_name} \\neq {asymp_expr}, \\quad k \\in \\mathbb{{Z}}$$'
            })

    # ---------------------------------------------------------
    # 2. PERHITUNGAN DOMAIN ALAMI VIA SYMPY
    # ---------------------------------------------------------
    try:
        dom = continuous_domain(f_expr, var, sp.S.Reals)
        dom_latex = sp.latex(dom)
    except Exception:
        dom = sp.S.Reals
        dom_latex = '\\mathbb{R}'

    def _format_domain_set(d):
        if d == sp.S.Reals:
            return f'\\{{{var_name} \\in \\mathbb{{R}}\\}}'
        if f_expr.has(sp.tan):
            return f'\\{{{var_name} \\in \\mathbb{{R}} \\mid {var_name} \\neq \\frac{{\\pi}}{{2}} + k\\pi, \\; k \\in \\mathbb{{Z}}\\}}'
        if f_expr.has(sp.cot):
            return f'\\{{{var_name} \\in \\mathbb{{R}} \\mid {var_name} \\neq k\\pi, \\; k \\in \\mathbb{{Z}}\\}}'
        if isinstance(d, sp.Interval):
            left, right = d.left, d.right
            l_open, r_open = d.left_open, d.right_open
            if left == -sp.oo and right == sp.oo:
                return f'\\{{{var_name} \\in \\mathbb{{R}}\\}}'
            if left == -sp.oo:
                op = '<' if r_open else '\\le'
                return f'\\{{{var_name} \\in \\mathbb{{R}} \\mid {var_name} {op} {sp.latex(right)}\\}}'
            if right == sp.oo:
                op = '>' if l_open else '\\ge'
                return f'\\{{{var_name} \\in \\mathbb{{R}} \\mid {var_name} {op} {sp.latex(left)}\\}}'
            lop = '<' if l_open else '\\le'
            rop = '<' if r_open else '\\le'
            return f'\\{{{var_name} \\in \\mathbb{{R}} \\mid {sp.latex(left)} {lop} {var_name} {rop} {sp.latex(right)}\\}}'
        if isinstance(d, sp.Union):
            args = sorted([inv for inv in d.args if isinstance(inv, sp.Interval)], key=lambda i: i.left)
            if args:
                all_left = min(inv.left for inv in args)
                all_right = max(inv.right for inv in args)
                holes = []
                for i in range(len(args)-1):
                    if args[i].right == args[i+1].left and args[i].right_open and args[i+1].left_open:
                        holes.append(args[i].right)
                if holes:
                    base_cond = []
                    if all_left != -sp.oo:
                        base_cond.append(f'{var_name} > {sp.latex(all_left)}' if args[0].left_open else f'{var_name} \\ge {sp.latex(all_left)}')
                    if all_right != sp.oo:
                        base_cond.append(f'{var_name} < {sp.latex(all_right)}' if args[-1].right_open else f'{var_name} \\le {sp.latex(all_right)}')
                    for h in holes:
                        base_cond.append(f'{var_name} \\neq {sp.latex(h)}')
                    join_dan = ' \\text{ dan } '.join(base_cond)
                    return f'\\{{{var_name} \\in \\mathbb{{R}} \\mid {join_dan}\\}}'
                else:
                    parts = []
                    for inv in args:
                        s_part = _format_domain_set(inv)
                        if s_part:
                            inner = s_part.replace(f'\\{{{var_name} \\in \\mathbb{{R}} \\mid ', '').replace('\\}', '')
                            parts.append(inner)
                    if parts:
                        join_atau = ' \\text{ atau } '.join(parts)
                        return f'\\{{{var_name} \\in \\mathbb{{R}} \\mid {join_atau}\\}}'
        return None

    set_latex = _format_domain_set(dom)

    # ---------------------------------------------------------
    # 3. TITIK POTONG SUMBU X DAN Y
    # ---------------------------------------------------------
    # Titik Potong Sumbu X
    real_roots = [sp.latex(r) for r in _get_real_roots(f_expr, var)]

    # Titik Potong Sumbu Y: f(0)
    y_intercept = None
    try:
        y_val = f_expr.subs(var, 0)
        if _is_real_finite(y_val):
            y_intercept = sp.latex(y_val)
    except Exception:
        pass

    # ---------------------------------------------------------
    # 4. ASIMTOT (TEGAK, DATAR, MIRING)
    # ---------------------------------------------------------
    # Asimtot Tegak
    vert_asymp = []
    try:
        sings = singularities(f_expr, var)
        if isinstance(sings, sp.FiniteSet):
            vert_asymp = [sp.latex(s) for s in sings if getattr(s, 'is_real', False)]
        elif sings != sp.EmptySet:
            for trig_cls, _, _, asymp_expr in trig_asymp:
                if f_expr.has(trig_cls):
                    vert_asymp.append(asymp_expr)
    except Exception:
        pass

    # Asimtot Datar (Limit menuju +/- tak hingga)
    horiz_asymp = []
    for inf_dir in (sp.oo, -sp.oo):
        try:
            lim = sp.limit(f_expr, var, inf_dir)
            if _is_real_finite(lim):
                lat = sp.latex(lim)
                if lat not in horiz_asymp:
                    horiz_asymp.append(lat)
        except Exception:
            pass

    # Asimtot Miring (Slant / Oblique: y = mx + c)
    slant_asymp = None
    try:
        num, den = sp.fraction(sp.together(f_expr))
        if den != 1 and num.is_polynomial(var) and den.is_polynomial(var):
            deg_num = sp.degree(num, var)
            deg_den = sp.degree(den, var)
            if deg_num == deg_den + 1:
                q, r = sp.div(num, den, var)
                slant_asymp = sp.latex(q)
    except Exception:
        pass

    # ---------------------------------------------------------
    # 5. TURUNAN PERTAMA & TITIK STASIONER
    # ---------------------------------------------------------
    turunan_latex = None
    turunan_str = None
    stasioner_pts = []
    try:
        f_prime = sp.diff(f_expr, var)
        turunan_latex = sp.latex(f_prime)
        turunan_str = str(f_prime)

        # Cari titik stasioner f'(x) = 0
        crit_roots = _get_real_roots(f_prime, var)
        for cr in crit_roots:
            try:
                f_val = f_expr.subs(var, cr)
                if _is_real_finite(f_val):
                    stasioner_pts.append({
                        'x': sp.latex(cr),
                        'y': sp.latex(f_val)
                    })
            except Exception:
                pass
    except Exception:
        pass

    # ---------------------------------------------------------
    # 6. SIMETRI FUNGSI (GENAP / GANJIL)
    # ---------------------------------------------------------
    simetri = "Bukan keduanya"
    try:
        f_neg = sp.simplify(f_expr.subs(var, -var))
        if sp.simplify(f_neg - f_expr) == 0:
            simetri = "Genap (simetris terhadap sumbu Y)"
        elif sp.simplify(f_neg + f_expr) == 0:
            simetri = "Ganjil (simetris terhadap titik asal (0,0))"
    except Exception:
        pass

    # ---------------------------------------------------------
    # 7. REKOMENDASI RENTANG OPTIMAL GRAFIK (SMART BOUNDING)
    # ---------------------------------------------------------
    rec_xmin, rec_xmax, rec_ymin, rec_ymax = -10, 10, -10, 10

    # Khusus untuk fungsi berpangkat tinggi seperti x^4, x^6, atau eksponensial e^x,
    # batasi rentang X agar kurva tidak tampak seperti garis vertikal datar.
    if f_expr.is_polynomial(var):
        deg = sp.degree(f_expr, var)
        if deg >= 6:
            rec_xmin, rec_xmax = -2.5, 2.5
            rec_ymin, rec_ymax = -1, 15
        elif deg >= 4:
            rec_xmin, rec_xmax = -3.5, 3.5
            rec_ymin, rec_ymax = -2, 20
        elif deg == 2:
            # Kuadratik: pusatkan di puncak/lembah
            if stasioner_pts:
                try:
                    xv = float(sp.sympify(stasioner_pts[0]['x']).evalf())
                    yv = float(sp.sympify(stasioner_pts[0]['y']).evalf())
                    rec_xmin = round(xv - 6, 2)
                    rec_xmax = round(xv + 6, 2)
                    rec_ymin = round(min(yv - 2, -5), 2)
                    rec_ymax = round(max(yv + 10, 10), 2)
                except Exception:
                    pass
    elif f_expr.has(sp.exp):
        rec_xmin, rec_xmax = -4, 4
        rec_ymin, rec_ymax = -1, 15
    elif isinstance(dom, sp.Interval):
        if dom.left != -sp.oo and dom.right != sp.oo:
            l = float(dom.left.evalf())
            r = float(dom.right.evalf())
            span = max(1.0, r - l)
            rec_xmin = round(l - span * 0.15, 2)
            rec_xmax = round(r + span * 0.15, 2)
            rec_ymin = -2
            rec_ymax = round(max(span * 1.2, 5.0), 2)
        elif dom.left != -sp.oo:
            l = float(dom.left.evalf())
            rec_xmin = round(l - 1.0, 2)
            rec_xmax = round(l + 10.0, 2)
            rec_ymin = -2
            rec_ymax = 8
        elif dom.right != sp.oo:
            r = float(dom.right.evalf())
            rec_xmin = round(r - 10.0, 2)
            rec_xmax = round(r + 1.0, 2)
            rec_ymin = -2
            rec_ymax = 8
    elif vert_asymp:
        try:
            pts = [float(sp.sympify(v).evalf()) for v in vert_asymp if v not in ('\\frac{\\pi}{2} + k\\pi', 'k\\pi')]
            if pts:
                mid = sum(pts) / len(pts)
                rec_xmin = round(mid - 6.0, 2)
                rec_xmax = round(mid + 6.0, 2)
                rec_ymin = -10
                rec_ymax = 10
        except Exception:
            pass

    # ---------------------------------------------------------
    # 8. TABEL NILAI SAMPEL (7 TITIK)
    # ---------------------------------------------------------
    sample_table = []
    try:
        sample_xs = np.linspace(rec_xmin, rec_xmax, 7)
        for sx in sample_xs:
            sx_rounded = round(float(sx), 2)
            try:
                val = f_expr.subs(var, sx_rounded)
                val_num = to_float(val)
                if val_num is not None and not getattr(val, 'has', lambda s: False)(sp.I):
                    sample_table.append({'x': sx_rounded, 'y': round(val_num, 4), 'terdefinisi': True})
                else:
                    sample_table.append({'x': sx_rounded, 'y': 'Tak terdefinisi', 'terdefinisi': False})
            except Exception:
                sample_table.append({'x': sx_rounded, 'y': 'Tak terdefinisi', 'terdefinisi': False})
    except Exception:
        pass

    return {
        'sukses': True,
        'fungsi_str': expr_str,
        'fungsi_latex': sp.latex(f_expr),
        'variabel': var_name,
        'domain_latex': dom_latex,
        'domain_himpunan': set_latex,
        'syarat': syarat_list,
        'akar': real_roots,
        'potong_y': y_intercept,
        'asimtot_tegak': vert_asymp,
        'asimtot_datar': horiz_asymp,
        'asimtot_miring': slant_asymp,
        'titik_stasioner': stasioner_pts,
        'simetri': simetri,
        'turunan_latex': turunan_latex,
        'turunan_str': turunan_str,
        'rentang': {
            'xmin': rec_xmin,
            'xmax': rec_xmax,
            'ymin': rec_ymin,
            'ymax': rec_ymax
        },
        'tabel_nilai': sample_table
    }
