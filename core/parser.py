"""
core/parser.py
Parser matematika cerdas, normalisasi input untuk pengguna awam, dan validasi ekspresi.
"""
import re
import sympy as sp
from sympy.parsing.sympy_parser import parse_expr

import numpy as np

from core.config import (
    MAX_FUNCTION_LENGTH,
    MAX_POWER_VALUE,
    MAX_PAREN_DEPTH,
    MAX_DIGIT_LENGTH,
    _BLOCKED_KEYWORDS,
    _BLOCKED_CHARS_RE,
    LOCAL_DICT,
    TRANSFORMATIONS,
    UNICODE_SUPERSCRIPTS,
    VARS,
    x, y, t
)

KNOWN_FUNCS = [
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
    'asin', 'acos', 'atan', 'acot', 'asec', 'acsc',
    'sinh', 'cosh', 'tanh',
    'ln', 'log', 'log10', 'log2', 'exp', 'sqrt', 'cbrt', 'abs', 'Abs'
]


def to_float(val, default=None):
    """Mengonversi nilai SymPy atau numerik ke float secara aman."""
    if val is None:
        return default
    try:
        res = val.evalf() if hasattr(val, 'evalf') else val
        f = float(res)
        return f if np.isfinite(f) else default
    except Exception:
        return default


def validate_fungsi(expr_str):
    """
    Validasi keamanan, batas ukuran, struktur kurung, dan pola eksponen ekspresi input.
    Mencegah serangan Denial of Service.
    Menghasilkan (sukses: bool, pesan_error: str).
    """
    if not isinstance(expr_str, str):
        return False, "Fungsi harus berupa teks (string)."
    s = expr_str.strip()
    if not s:
        return False, "Fungsi tidak boleh kosong. Masukkan ekspresi seperti: x^2 + 2x - 3"
    if len(s) > MAX_FUNCTION_LENGTH:
        return False, f"Fungsi terlalu panjang (maksimal {MAX_FUNCTION_LENGTH} karakter, saat ini {len(s)})."

    # 1. Cek kata kunci berbahaya
    low = s.lower()
    for kw in _BLOCKED_KEYWORDS:
        if kw in low:
            return False, f"Kata kunci tidak diizinkan demi keamanan: {kw}"

    # 2. Cek karakter terlarang injeksi
    if _BLOCKED_CHARS_RE.search(s):
        return False, "Karakter tidak diizinkan terdeteksi (seperti ; ` $ \" ' # dll)."

    # 3. Deteksi spam berulang
    if len(s) > 50 and len(set(s)) < 3:
        return False, "Fungsi terlihat tidak valid atau spam."

    # 4. Batasi kedalaman tanda kurung bersarang (mencegah stack overflow / recursion error)
    depth = 0
    for ch in s:
        if ch in '([{':
            depth += 1
            if depth > MAX_PAREN_DEPTH:
                return False, f"Kurung bersarang terlalu dalam (maksimal {MAX_PAREN_DEPTH} tingkat)."
        elif ch in ')]}':
            depth = max(0, depth - 1)

    # 5. Blokir eksponen bertingkat (Power Towers seperti a^b^c atau 9^9^9^9 yang membekukan CPU)
    if re.search(r'(?:\^|\*\*)\s*\(?[^+\-*/()]*\s*(?:\^|\*\*)', s):
        return False, "Eksponen bertingkat (seperti a^b^c) tidak diizinkan demi keamanan server. Sederhanakan fungsi terlebih dahulu."

    # 6. Batasi nilai pangkat numerik maksimal (mencegah perpangkatan bilangan raksasa)
    for m in re.finditer(r'(?:\^|\*\*)\s*\(?([0-9]+)', s):
        try:
            if int(m.group(1)) > MAX_POWER_VALUE:
                return False, f"Pangkat terlalu besar (maksimal pangkat {MAX_POWER_VALUE})."
        except ValueError:
            return False, "Nilai pangkat tidak valid."

    # 7. Batasi panjang digit angka integer (mencegah komputasi integer raksasa)
    if re.search(r'\d{16,}', s):
        return False, "Angka dalam fungsi terlalu panjang (maksimal 15 digit)."

    # 8. Deteksi operator berulang berlebihan (seperti +++++ atau ******)
    if re.search(r'[+]{3,}|[-]{3,}|[*]{3,}|[/]{2,}', s):
        return False, "Operator berulang berlebihan terdeteksi."

    return True, ""


def preprocess_math_input(raw_str):
    """
    Membersihkan dan menormalkan input matematika agar 'foolproof' bagi pengguna awam:
    - Menghapus awalan 'f(x) =', 'y =', dll.
    - Mengonversi superskrip Unicode (x², x³, dll.).
    - Mengonversi simbol matematika (√, π, ×, ÷, –, |x|).
    - Menangani koma sebagai pemisah desimal khas Indonesia (misal: 2,5 -> 2.5).
    - Mengonversi sinonim trigonometri (tg, ctg, arcsin, sin^-1).
    - Memasukkan perkalian implisit (2x, 2(x+1), x sin(x)).
    - Mengoreksi penulisan tanpa kurung (sin x, cos 2x, ln x).
    - Mengoreksi kurung yang lupa ditutup di akhir.
    """
    if not raw_str or not isinstance(raw_str, str):
        return ""

    s = raw_str.strip()

    # 1. Hapus awalan penamaan fungsi (f(x) =, y =, g(x) =, f(t) =, dll.)
    s = re.sub(r'^\s*[a-zA-Z]\s*\([a-zA-Z]\)\s*=\s*', '', s)
    s = re.sub(r'^\s*[yY]\s*=\s*', '', s)

    # 2. Normalisasi tanda minus, kali, bagi, dan pi Unicode
    s = s.replace('−', '-').replace('–', '-').replace('—', '-')
    s = s.replace('×', '*').replace('·', '*').replace('•', '*')
    s = s.replace('÷', '/')
    s = s.replace('π', 'pi').replace('Π', 'pi')

    # 3. Normalisasi kurung siku [] dan kurawal {} menjadi kurung biasa ()
    s = s.replace('[', '(').replace(']', ')')
    s = s.replace('{', '(').replace('}', ')')

    # 4. Tangani superskrip Unicode (misal: x², x³, x⁴, x⁻¹)
    for sup_char, norm_char in UNICODE_SUPERSCRIPTS.items():
        s = s.replace(sup_char, f"^{norm_char}")
    s = re.sub(r'\^(-|\+)\^(\d+)', r'^(\1\2)', s)
    s = re.sub(r'\^(\d+)\^(\d+)', r'^\1\2', s)

    # 5. Tangani simbol akar √x atau √(x+1)
    s = re.sub(r'√\s*\(([^)]+)\)', r'sqrt(\1)', s)
    s = re.sub(r'√\s*([a-zA-Z0-9_]+)', r'sqrt(\1)', s)
    s = s.replace('√', 'sqrt')

    # 6. Tangani koma desimal Indonesia: 2,5 -> 2.5
    s = re.sub(r'(\d+),(\d+)', r'\1.\2', s)

    # 7. Tangani tanda nilai mutlak |x| atau |x - 3| -> Abs(...)
    s = re.sub(r'\|([^|]+)\|', r'Abs(\1)', s)

    # 8. Notasi invers & sinonim trigonometri Indonesia
    trig_synonyms = [
        (r'sin\s*\^?\s*\(?-1\)?\s*\(', 'asin('),
        (r'cos\s*\^?\s*\(?-1\)?\s*\(', 'acos('),
        (r'tan\s*\^?\s*\(?-1\)?\s*\(', 'atan('),
        (r'\barcsin\b', 'asin'),
        (r'\barccos\b', 'acos'),
        (r'\barctan\b', 'atan'),
        (r'\btg\b', 'tan'),
        (r'\bctg\b', 'cot'),
        (r'\bcotan\b', 'cot'),
        (r'\bcosec\b', 'csc')
    ]
    for pat, repl in trig_synonyms:
        s = re.sub(pat, repl, s, flags=re.IGNORECASE)

    # 9. Normalisasi nama fungsi dan penulisan tanpa kurung (misal: sin x, cos 2x, x sin(x))
    for fn in KNOWN_FUNCS:
        s = re.sub(rf'\b{fn}\b', fn, s, flags=re.IGNORECASE)
        s = re.sub(rf'\b{fn}\s+([a-zA-Z0-9_]+)', rf'{fn}(\1)', s)
        s = re.sub(rf'([a-zA-Z0-9])\s+{fn}\(', rf'\1*{fn}(', s)

    # 10. Pangkat: ganti ^ dengan **
    s = s.replace('^', '**')

    # 11. Konstanta bilangan Euler 'e' (hanya bila berdiri sendiri)
    s = re.sub(r'(?<![a-zA-Z0-9_])e(?![a-zA-Z0-9_])', 'E', s)

    # 12. Perkalian implisit lanjutan
    s = re.sub(r'(\d)\s*([a-zA-Z])', r'\1*\2', s)           # 2x -> 2*x
    s = re.sub(r'(\d)\s*\(', r'\1*(', s)                    # 2(x+1) -> 2*(x+1)
    s = re.sub(r'\)\s*\(', r')*(', s)                       # (x+1)(x-1) -> (x+1)*(x-1)
    s = re.sub(r'\)\s*([a-zA-Z])', r')*\1', s)              # (x+1)x -> (x+1)*x
    s = re.sub(r'\)\s*(\d)', r')*\1', s)                    # (x+1)2 -> (x+1)*2
    s = re.sub(r'\b(pi|E)\s*([a-zA-Z])', r'\1*\2', s)       # pi x -> pi*x, E x -> E*x

    # 13. Auto-balance kurung jika tertinggal kurung tutup di ujung (maksimal 3 kurung)
    open_count = s.count('(')
    close_count = s.count(')')
    diff = open_count - close_count
    if 0 < diff <= 3:
        s = s + ')' * diff

    return s.strip()


def safe_parse_expr(func_str):
    """
    Mengurai string matematika menjadi objek SymPy secara aman dan toleran kesalahan.
    Mengembalikan objek SymPy expression jika berhasil, atau None jika gagal.
    """
    if not func_str or not isinstance(func_str, str):
        return None

    cleaned = preprocess_math_input(func_str)
    if not cleaned:
        return None

    try:
        expr = parse_expr(cleaned, local_dict=LOCAL_DICT, transformations=TRANSFORMATIONS)
        return expr[0] if isinstance(expr, tuple) else expr
    except Exception:
        # Percobaan pemulihan kedua: tambahkan tanda perkalian eksplisit yang lebih agresif
        try:
            fallback = re.sub(r'([xyzt])([a-zA-Z])', r'\1*\2', cleaned)
            expr = parse_expr(fallback, local_dict=LOCAL_DICT, transformations=TRANSFORMATIONS)
            return expr[0] if isinstance(expr, tuple) else expr
        except Exception:
            return None


# Alias semantik
parse_function = safe_parse_expr


def detect_var(expr, requested=None):
    """
    Mendeteksi variabel utama dalam ekspresi matematika.
    Memprioritaskan variabel yang diminta pengguna, kemudian x, t, y, u, z, theta.
    """
    if requested:
        req_clean = str(requested).strip().lower()
        if req_clean in VARS:
            return VARS[req_clean]

    if expr is not None and hasattr(expr, 'free_symbols'):
        syms = expr.free_symbols
        for sym_name in ('x', 't', 'y', 'u', 'z', 'theta'):
            for s in syms:
                if str(s).lower() == sym_name:
                    return s
        if syms:
            return sorted(list(syms), key=lambda s: str(s))[0]

    return x


def get_requested_var(data):
    """Mengekstrak nama variabel dari payload request pengguna."""
    if not isinstance(data, dict):
        return None
    for k in ('variabel', 'variable', 'var', 'symbol'):
        v = data.get(k)
        if isinstance(v, str) and v.strip().lower() in VARS:
            return v.strip().lower()
    return None


def parse_numeric_or_symbolic(val_str, default=None):
    """
    Mengurai input nilai numerik atau simbolik (seperti titik limit, batas integral, titik turunan).
    Mendukung angka, desimal koma, pecahan, nilai infinity, serta konstanta (pi, e, sqrt).
    Mengembalikan (sym_val, float_val_or_none, error_msg).
    """
    if val_str is None or str(val_str).strip() == '':
        return default, None, None

    s = str(val_str).strip()
    low = s.lower().replace(' ', '')

    # Tak hingga
    if low in ('oo', 'inf', 'infinity', '+oo', '+inf', 'takhingga', '+takhingga'):
        return sp.oo, None, None
    if low in ('-oo', '-inf', '-infinity', '-takhingga'):
        return -sp.oo, None, None

    val_sym = safe_parse_expr(s)
    if val_sym is None:
        return None, None, f"Nilai '{val_str}' tidak valid sebagai angka atau konstanta matematika."

    return val_sym, to_float(val_sym), None
