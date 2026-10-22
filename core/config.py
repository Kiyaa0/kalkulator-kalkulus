"""
core/config.py
Konfigurasi dasar, konstanta keamanan, dan simbol matematika untuk CalcKu.
"""
import re
import sympy as sp
from sympy.parsing.sympy_parser import (
    standard_transformations,
    implicit_multiplication_application,
)

# Batasan & Timeout
MAX_FUNCTION_LENGTH = 250
MAX_ORDE = 10
SYMPY_TIMEOUT = 5
MAX_POWER_VALUE = 50          # Batas nilai eksponen numerik
MAX_PAREN_DEPTH = 10          # Batas kedalaman tanda kurung bersarang
MAX_DIGIT_LENGTH = 15         # Batas panjang digit integer
MAX_TRACKED_IPS = 5000        # Batas kapasitas IP aktif pada rate limiter memori

# Keamanan & Sanitasi
_BLOCKED_KEYWORDS = [
    '__', 'import', 'exec', 'eval', 'open', 'os.', 'sys.',
    'subprocess', 'compile', 'globals', 'locals', 'getattr', 'setattr',
    'delattr', 'hasattr', 'builtins', 'breakpoint', 'input', 'shutil',
    'pty', 'popen', 'system', 'lambda', 'vars', 'exit', 'quit'
]

# Karakter berbahaya (karakter injeksi kode/shell)
# Catatan: Karakter matematika sah seperti |, =, ^, √, π, _, +, -, *, / diizinkan
_BLOCKED_CHARS_RE = re.compile(r'[;`$\\\'"#@!&?<>:~]')

# Simbol Matematika Inti
x = sp.Symbol('x')
y = sp.Symbol('y')
t = sp.Symbol('t')
theta = sp.Symbol('theta')
u = sp.Symbol('u')
z = sp.Symbol('z')
s = sp.Symbol('s')

VARS = {
    'x': x, 'y': y, 't': t, 'theta': theta, 'u': u, 'z': z, 's': s,
    'X': x, 'Y': y, 'T': t, 'THETA': theta, 'U': u, 'Z': z, 'S': s
}

TRANSFORMATIONS = standard_transformations + (implicit_multiplication_application,)


def smart_root(arg1, arg2):
    """Fungsi akar cerdas: mendukung root(x, n) maupun root(n, x)."""
    try:
        a_sym = sp.sympify(arg1)
        b_sym = sp.sympify(arg2)
        if a_sym.is_number and not b_sym.is_number:
            return sp.root(b_sym, a_sym)
    except Exception:
        pass
    return sp.root(arg1, arg2)


LOCAL_DICT = {
    'x': x, 'y': y, 't': t, 'theta': theta, 'u': u, 'z': z, 's': s,
    'X': x, 'Y': y, 'T': t, 'U': u, 'Z': z, 'S': s,
    'sin': sp.sin, 'cos': sp.cos, 'tan': sp.tan,
    'cot': sp.cot, 'sec': sp.sec, 'csc': sp.csc,
    'asin': sp.asin, 'acos': sp.acos, 'atan': sp.atan,
    'acot': sp.acot, 'asec': sp.asec, 'acsc': sp.acsc,
    'sinh': sp.sinh, 'cosh': sp.cosh, 'tanh': sp.tanh,
    'log': sp.log, 'ln': sp.log,
    'log10': lambda v: sp.log(v, 10),
    'log2': lambda v: sp.log(v, 2),
    'exp': sp.exp, 'sqrt': sp.sqrt, 'cbrt': sp.cbrt, 'root': smart_root,
    'Abs': sp.Abs, 'abs': sp.Abs,
    'pi': sp.pi, 'PI': sp.pi,
    'E': sp.E, 'e': sp.E,
    'oo': sp.oo, 'inf': sp.oo, 'infinity': sp.oo,
}

UNICODE_SUPERSCRIPTS = {
    '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
    '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
    '⁻': '-', '⁺': '+'
}
