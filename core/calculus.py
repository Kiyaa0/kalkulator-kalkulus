"""
core/calculus.py
Mesin kalkulus untuk Turunan (Derivative), Integral, dan Limit.
Mendukung evaluasi titik, analisis konvergensi, penjelasan langkah, dan notasi LaTeX.
"""
import sympy as sp


def simplify_integral(expr):
    """Mencari bentuk representasi integral yang paling ringkas dan rapi."""
    if expr is None:
        return None
    candidates = [
        expr,
        sp.factor(expr),
        sp.simplify(expr),
        sp.radsimp(expr),
        sp.powsimp(expr, deep=True),
    ]
    return min(candidates, key=lambda e: len(str(e)))


def _format_evaluated_val(val, default_desc="Tak terdefinisi (asimtot / kemiringan vertikal)"):
    """Format nilai hasil evaluasi simbolik ke LaTeX dan string teks."""
    if val in (sp.zoo, sp.oo, -sp.oo, sp.nan):
        return "\\text{Tak terdefinisi}", default_desc
    return sp.latex(val), str(val)


def compute_derivative(f_expr, var, orde=1, point_sym=None):
    """
    Menghitung turunan ke-n dari f_expr terhadap var.
    Opsional mengevaluasi nilai turunan pada point_sym.
    """
    var_name = str(var)
    derivative_expr = sp.simplify(sp.diff(f_expr, var, orde))

    if orde == 1:
        notasi = f"\\frac{{d}}{{d{var_name}}} \\left({sp.latex(f_expr)}\\right)"
    elif orde == 2:
        notasi = f"\\frac{{d^2}}{{d{var_name}^2}} \\left({sp.latex(f_expr)}\\right)"
    elif orde == 3:
        notasi = f"\\frac{{d^3}}{{d{var_name}^3}} \\left({sp.latex(f_expr)}\\right)"
    else:
        notasi = f"\\frac{{d^{{{orde}}}}}{{d{var_name}^{{{orde}}}}} \\left({sp.latex(f_expr)}\\right)"

    res = {
        'sukses': True,
        'hasil': sp.latex(derivative_expr),
        'hasil_str': str(derivative_expr),
        'derivative_expr': derivative_expr,
        'fungsi_latex': sp.latex(f_expr),
        'variabel': var_name,
        'orde': orde,
        'notasi': notasi,
        'evaluasi': None,
        'evaluasi_str': None,
        'titik': None,
        'langkah': []
    }

    # Identifikasi metode / aturan turunan untuk langkah edukatif
    steps = [
        {
            'judul': f'1. Identifikasi Fungsi & Orde Turunan',
            'teks': f'Menghitung turunan orde ke-{orde} dari fungsi f({var_name}) = {sp.latex(f_expr)} terhadap variabel {var_name}.'
        }
    ]

    # Aturan kalkulus
    rule_note = []
    if f_expr.is_polynomial(var):
        rule_note.append('Aturan Pangkat: \\frac{d}{dx}[x^n] = n x^{n-1}')
    if f_expr.has(sp.sin, sp.cos, sp.tan, sp.cot, sp.sec, sp.csc):
        rule_note.append('Aturan Turunan Fungsi Trigonometri')
    if f_expr.has(sp.exp):
        rule_note.append('Aturan Eksponensial: \\frac{d}{dx}[e^u] = e^u \\cdot u\'')
    if f_expr.has(sp.log):
        rule_note.append('Aturan Logaritma Alami: \\frac{d}{dx}[\\ln(u)] = \\frac{u\'}{u}')
    if isinstance(f_expr, sp.Mul):
        rule_note.append('Aturan Perkalian (Product Rule): (u \\cdot v)\' = u\'v + uv\'')
    num, den = sp.fraction(f_expr)
    if den != 1 and den.has(var):
        rule_note.append('Aturan Pembagian (Quotient Rule): \\left(\\frac{u}{v}\\right)\' = \\frac{u\'v - uv\'}{v^2}')

    if rule_note:
        steps.append({
            'judul': '2. Kaidah Kalkulus yang Diterapkan',
            'teks': 'Menggunakan ' + ', '.join(rule_note) + '.'
        })

    steps.append({
        'judul': f'3. Hasil Diferensiasi (Orde {orde})',
        'latex': f"{notasi} = {sp.latex(derivative_expr)}"
    })

    # Evaluasi nilai di titik jika diberikan
    if point_sym is not None:
        try:
            evaluated = derivative_expr.subs(var, point_sym)
            eval_latex, eval_str = _format_evaluated_val(evaluated)

            res['evaluasi'] = eval_latex
            res['evaluasi_str'] = eval_str
            res['titik'] = sp.latex(point_sym)
            res['evaluated_expr'] = evaluated

            steps.append({
                'judul': f'4. Evaluasi pada Titik {var_name} = {sp.latex(point_sym)}',
                'latex': f"f^{{({orde})}}({sp.latex(point_sym)}) = {eval_latex}",
                'teks': f"Substitusikan nilai {var_name} = {sp.latex(point_sym)} ke dalam rumus turunan."
            })
        except Exception:
            pass

    res['langkah'] = steps
    return res


def compute_integral(f_expr, var, lb=None, ub=None):
    """
    Menghitung integral tak tentu atau tentu dari f_expr terhadap var.
    Mendukung batas numerik dan simbolik (pi, e, tak hingga).
    """
    var_name = str(var)
    indef_raw = sp.integrate(f_expr, var)
    indef_expr = simplify_integral(indef_raw)
    latex_input = sp.latex(f_expr)
    indef_latex = sp.latex(indef_expr)

    res = {
        'sukses': True,
        'hasil': indef_latex,
        'hasil_str': str(indef_expr),
        'indef_expr': indef_expr,
        'fungsi_latex': latex_input,
        'variabel': var_name,
        'notasi': f"\\int {latex_input}\\,d{var_name}",
        'tentu': None,
        'tentu_str': None,
        'def_val': None,
        'langkah': []
    }

    steps = [
        {
            'judul': '1. Bentuk Masalah Integrasi',
            'teks': f'Mencari antiturunan (antiderivative) dari f({var_name}) = {latex_input} terhadap d{var_name}.'
        }
    ]

    # Identifikasi teknik integrasi
    notes = []
    if f_expr.is_polynomial(var):
        notes.append('Aturan Pangkat Integral: \\int x^n dx = \\frac{x^{n+1}}{n+1} + C')
    if f_expr.has(sp.sin, sp.cos, sp.tan):
        notes.append('Rumus Standar Integrasi Trigonometri')
    if f_expr.has(sp.exp):
        notes.append('Integrasi Eksponensial: \\int e^{ax} dx = \\frac{1}{a}e^{ax} + C')
    num, den = sp.fraction(f_expr)
    if den != 1 and den.has(var):
        notes.append('Pecahan Parsial / Substitusi Aljabar')

    if notes:
        steps.append({
            'judul': '2. Metode Integrasi',
            'teks': 'Menggunakan ' + ', '.join(notes) + '.'
        })

    steps.append({
        'judul': '3. Antiturunan Umum',
        'latex': f"\\int {latex_input}\\,d{var_name} = {indef_latex} + C"
    })

    # Jika batas bawah dan batas atas diisi (Integral Tentu)
    if lb is not None and ub is not None:
        notasi_tentu = f"\\int_{{{sp.latex(lb)}}}^{{{sp.latex(ub)}}} {latex_input}\\,d{var_name}"
        res['notasi'] = notasi_tentu

        try:
            def_val = sp.integrate(f_expr, (var, lb, ub))
            # Jika SymPy tidak dapat menyelesaikan secara simbolis, gunakan aproksimasi numerik
            if isinstance(def_val, sp.Integral):
                try:
                    def_val = def_val.evalf()
                except Exception:
                    pass

            tentu_latex = sp.latex(def_val)
            tentu_str = str(def_val)
            res['tentu'] = tentu_latex
            res['tentu_str'] = tentu_str
            res['def_val'] = def_val

            # Teorema Dasar Kalkulus
            steps.append({
                'judul': '4. Teorema Dasar Kalkulus (Fundamental Theorem of Calculus)',
                'teks': f'Evaluasi batas atas dikurangi batas bawah: [F({sp.latex(ub)}) - F({sp.latex(lb)})].',
                'latex': f"{notasi_tentu} = \\left[ {indef_latex} \\right]_{{{sp.latex(lb)}}}^{{{sp.latex(ub)}}} = {tentu_latex}"
            })
        except Exception as e:
            res['tentu'] = f"Gagal mengevaluasi batas: {str(e)}"
            res['tentu_str'] = str(e)

    res['langkah'] = steps
    return res


def compute_limit(f_expr, var, point_sym, direction='+-'):
    """
    Menghitung limit f_expr ketika var menuju point_sym dengan arah tertentu:
    - '+-' : limit dua sisi (two-sided)
    - '+'  : limit sepihak dari kanan (right-hand limit)
    - '-'  : limit sepihak dari kiri (left-hand limit)
    Menganalisis kontinuitas dan kesamaan limit kiri dan kanan.
    """
    var_name = str(var)
    dir_label = {'+': '^+', '-': '^-', '+-': ''}.get(direction, '')
    notasi = f"\\lim_{{{var_name} \\to {sp.latex(point_sym)}{dir_label}}} \\left({sp.latex(f_expr)}\\right)"

    limit_val = sp.limit(f_expr, var, point_sym, dir=direction)
    lat_val = sp.latex(limit_val)

    res = {
        'sukses': True,
        'hasil': lat_val,
        'hasil_str': str(limit_val),
        'limit_val': limit_val,
        'fungsi_latex': sp.latex(f_expr),
        'variabel': var_name,
        'titik': sp.latex(point_sym),
        'arah': direction,
        'notasi': notasi,
        'langkah': []
    }

    steps = [
        {
            'judul': '1. Perumusan Limit',
            'latex': notasi
        }
    ]

    # Evaluasi limit kiri dan kanan untuk limit dua sisi
    if direction == '+-':
        try:
            lim_left = sp.limit(f_expr, var, point_sym, dir='-')
            lim_right = sp.limit(f_expr, var, point_sym, dir='+')
            left_lat = sp.latex(lim_left)
            right_lat = sp.latex(lim_right)

            steps.append({
                'judul': '2. Limit Sepihak (Kiri & Kanan)',
                'teks': f"Limit dari kiri ($x \\to c^-$) dan limit dari kanan ($x \\to c^+$):",
                'latex': f"\\lim_{{{var_name} \\to {sp.latex(point_sym)}^-}} f({var_name}) = {left_lat}, \\quad \\lim_{{{var_name} \\to {sp.latex(point_sym)}^+}} f({var_name}) = {right_lat}"
            })

            if lim_left == lim_right:
                steps.append({
                    'judul': '3. Kesimpulan Eksistensi Limit',
                    'teks': f'Karena limit kiri sama dengan limit kanan ({left_lat} = {right_lat}), maka limit dua sisi ada.',
                    'latex': f"{notasi} = {lat_val}"
                })
            else:
                steps.append({
                    'judul': '3. Kesimpulan Eksistensi Limit',
                    'teks': f'Karena limit kiri ({left_lat}) tidak sama dengan limit kanan ({right_lat}), maka limit dua sisi tidak ada (Does Not Exist / DNE).',
                    'latex': f"{notasi} \\text{{ tidak ada}}"
                })
        except Exception:
            steps.append({
                'judul': '2. Hasil Evaluasi Limit',
                'latex': f"{notasi} = {lat_val}"
            })
    else:
        steps.append({
            'judul': '2. Hasil Evaluasi Limit Sepihak',
            'latex': f"{notasi} = {lat_val}"
        })

    res['langkah'] = steps
    return res
