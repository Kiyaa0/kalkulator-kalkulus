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

# Keamanan & Sanitasi
_BLOCKED_KEYWORDS = [
    '__', 'import', 'exec', 'eval', 'open', 'os.', 'sys.',
    'subprocess', 'compile', 'globals', 'locals', 'getattr', 'setattr',
    'builtins', 'breakpoint', 'input', 'shutil', 'pty'
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

VARS = {
    'x': x, 'y': y, 't': t, 'theta': theta, 'u': u, 'z': z,
    'X': x, 'Y': y, 'T': t, 'THETA': theta, 'U': u, 'Z': z
}

TRANSFORMATIONS = standard_transformations + (implicit_multiplication_application,)

LOCAL_DICT = {
    'x': x, 'y': y, 't': t, 'theta': theta, 'u': u, 'z': z,
    'X': x, 'Y': y, 'T': t, 'U': u, 'Z': z,
    'sin': sp.sin, 'cos': sp.cos, 'tan': sp.tan,
    'cot': sp.cot, 'sec': sp.sec, 'csc': sp.csc,
    'asin': sp.asin, 'acos': sp.acos, 'atan': sp.atan,
    'acot': sp.acot, 'asec': sp.asec, 'acsc': sp.acsc,
    'sinh': sp.sinh, 'cosh': sp.cosh, 'tanh': sp.tanh,
    'log': sp.log, 'ln': sp.log,
    'log10': lambda v: sp.log(v, 10),
    'log2': lambda v: sp.log(v, 2),
    'exp': sp.exp, 'sqrt': sp.sqrt, 'cbrt': sp.cbrt,
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
