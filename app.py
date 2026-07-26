from flask import Flask, render_template, request, jsonify
import sympy as sp
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import io, base64, re
from sympy.parsing.sympy_parser import (
    parse_expr,
    standard_transformations,
    implicit_multiplication_application,
)

app = Flask(__name__)
x = sp.Symbol('x')

TRANSFORMATIONS = standard_transformations + (implicit_multiplication_application,)
LOCAL_DICT = {
    'x': x,
    'sin': sp.sin, 'cos': sp.cos, 'tan': sp.tan,
    'asin': sp.asin, 'acos': sp.acos, 'atan': sp.atan,
    'log': sp.log, 'ln': sp.log,
    'log10': lambda v: sp.log(v, 10),
    'exp': sp.exp, 'sqrt': sp.sqrt,
    'Abs': sp.Abs, 'pi': sp.pi,
    'E': sp.E,
}


def parse_function(func_str):
    try:
        func_str = func_str.replace('^', '**')
        func_str = re.sub(r'\be\b', 'E', func_str)
        func_str = re.sub(r'(\d)([a-zA-Z])', r'\1*\2', func_str)
        func_str = re.sub(r'(x)\(', r'\1*(', func_str)
        func_str = re.sub(r'\)\(', r')*(', func_str)
        func_str = re.sub(r'\)([a-zA-Z])', r')*\1', func_str)
        func_str = re.sub(r'(\d)\(', r'\1*(', func_str)
        return parse_expr(func_str, local_dict=LOCAL_DICT, transformations=TRANSFORMATIONS)
    except Exception as e:
        return None


def sympy_to_numpy(expr):
    return sp.lambdify(x, expr, 'numpy')


def fig_to_base64(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=120, bbox_inches='tight', facecolor=fig.get_facecolor())
    buf.seek(0)
    b64 = base64.b64encode(buf.read()).decode('utf-8')
    plt.close(fig)
    return b64


def plot_limit(f_expr, func_str, point_sym, limit_val, direction):
    fig, ax = plt.subplots(figsize=(8, 4.5))
    fig.set_facecolor('#1e293b')
    ax.set_facecolor('#0f172a')
    try:
        f_numpy = sympy_to_numpy(f_expr)
        x_vals = np.linspace(float(point_sym) - 2, float(point_sym) + 2, 400)
        y_vals = f_numpy(x_vals)
        finite = np.isfinite(y_vals)
        ax.plot(x_vals[finite], y_vals[finite], label=f'f(x) = {func_str}', color='#38bdf8')
        if limit_val.is_finite:
            ax.plot(float(point_sym), float(limit_val), 'ro', markersize=8, label=f'Limit = {limit_val}')
        ax.set_xlabel('x', color='#94a3b8')
        ax.set_ylabel('f(x)', color='#94a3b8')
        ax.set_title(f'Limit di x \u2192 {point_sym}', color='#e2e8f0')
        ax.grid(True, color='#334155', alpha=0.5)
        ax.legend(facecolor='#1e293b', edgecolor='#334155', labelcolor='#e2e8f0')
        ax.tick_params(colors='#94a3b8')
        for spine in ax.spines.values():
            spine.set_color('#334155')
    except Exception:
        pass
    return fig_to_base64(fig)


def plot_derivative(f_expr, derivative_expr, func_str, order, point_val, evaluated):
    fig, ax = plt.subplots(figsize=(8, 4.5))
    fig.set_facecolor('#1e293b')
    ax.set_facecolor('#0f172a')
    try:
        f_numpy = sympy_to_numpy(f_expr)
        d_numpy = sympy_to_numpy(derivative_expr)
        x_min = point_val - 3 if point_val is not None else -5
        x_max = point_val + 3 if point_val is not None else 5
        x_vals = np.linspace(x_min, x_max, 400)
        y_f = f_numpy(x_vals)
        y_d = d_numpy(x_vals)
        ff = np.isfinite(y_f)
        fd = np.isfinite(y_d)
        ax.plot(x_vals[ff], y_f[ff], label=f'f(x) = {func_str}', color='#38bdf8')
        prime_label = "f" + "'" * order + "(x)"
        ax.plot(x_vals[fd], y_d[fd], label=prime_label, color='#f87171', linestyle='--')
        if point_val is not None and evaluated is not None and evaluated.is_finite and evaluated.is_real:
            ax.plot(point_val, float(evaluated), 'go', markersize=8, label=f'f({point_val}) = {float(evaluated):.4f}')
        ax.set_xlabel('x', color='#94a3b8')
        ax.set_ylabel('y', color='#94a3b8')
        ax.set_title(f'Turunan ke-{order}', color='#e2e8f0')
        ax.grid(True, color='#334155', alpha=0.5)
        ax.legend(facecolor='#1e293b', edgecolor='#334155', labelcolor='#e2e8f0')
        ax.tick_params(colors='#94a3b8')
        for spine in ax.spines.values():
            spine.set_color('#334155')
    except Exception:
        pass
    return fig_to_base64(fig)


def simplify_integral(expr):
    candidates = [expr, sp.factor(expr), sp.simplify(expr), sp.radsimp(expr), sp.powsimp(expr, deep=True)]
    return min(candidates, key=lambda e: len(str(e)))


def plot_integral(f_expr, indef_expr, func_str, lb, ub, def_val):
    fig, ax = plt.subplots(figsize=(8, 4.5))
    fig.set_facecolor('#1e293b')
    ax.set_facecolor('#0f172a')
    try:
        f_numpy = sympy_to_numpy(f_expr)
        ind_numpy = sympy_to_numpy(indef_expr)
        lb_f, ub_f = float(lb), float(ub)
        x_plot = np.linspace(min(lb_f, ub_f) - 2, max(lb_f, ub_f) + 2, 400)
        y_f = f_numpy(x_plot)
        y_ind = ind_numpy(x_plot)
        ff = np.isfinite(y_f)
        fi = np.isfinite(y_ind)
        ax.plot(x_plot[ff], y_f[ff], label=f'f(x) = {func_str}', color='#38bdf8')
        ax.plot(x_plot[fi], y_ind[fi], label='Integral Tak Tentu (C=0)', color='#4ade80', linestyle=':')
        x_fill = np.linspace(lb_f, ub_f, 100)
        y_fill = f_numpy(x_fill)
        ax.fill_between(x_fill, y_fill, color='#a855f7', alpha=0.3, label=f'Area = {float(def_val):.4f}')
        ax.set_xlabel('x', color='#94a3b8')
        ax.set_ylabel('y', color='#94a3b8')
        ax.set_title('Integral', color='#e2e8f0')
        ax.grid(True, color='#334155', alpha=0.5)
        ax.legend(facecolor='#1e293b', edgecolor='#334155', labelcolor='#e2e8f0')
        ax.tick_params(colors='#94a3b8')
        for spine in ax.spines.values():
            spine.set_color('#334155')
    except Exception:
        pass
    return fig_to_base64(fig)


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/turunan', methods=['POST'])
def turunan():
    data = request.get_json()
    expr_str = data.get('fungsi', '')
    orde = int(data.get('orde', 1))
    point_val = data.get('titik')
    try:
        f_expr = parse_function(expr_str)
        if f_expr is None:
            return jsonify({'sukses': False, 'error': 'Gagal mengurai fungsi'})
        derivative_expr = sp.diff(f_expr, x, orde)
        derivative_expr = sp.simplify(derivative_expr)
        result = {
            'sukses': True,
            'hasil': sp.latex(derivative_expr),
            'hasil_str': str(derivative_expr),
        }
        if orde == 1:
            result['notasi'] = f"\\frac{{d}}{{dx}} ({sp.latex(f_expr)})"
        elif orde == 2:
            result['notasi'] = f"\\frac{{d^2}}{{dx^2}} ({sp.latex(f_expr)})"
        elif orde == 3:
            result['notasi'] = f"\\frac{{d^3}}{{dx^3}} ({sp.latex(f_expr)})"
        else:
            result['notasi'] = f"\\frac{{d^{{{orde}}}}}{{dx^{{{orde}}}}} ({sp.latex(f_expr)})"
        evaluated = None
        if point_val is not None and point_val != '':
            pv = sp.nsimplify(float(point_val))
            evaluated = derivative_expr.subs(x, pv)
            result['evaluasi'] = sp.latex(evaluated)
            result['evaluasi_str'] = str(evaluated)
            result['titik'] = str(pv)
        plot_b64 = plot_derivative(f_expr, derivative_expr, expr_str, orde,
                                   float(sp.nsimplify(float(point_val))) if point_val not in (None, '') else None,
                                   evaluated)
        result['plot'] = plot_b64
        return jsonify(result)
    except Exception as e:
        return jsonify({'sukses': False, 'error': str(e)})


@app.route('/api/integral', methods=['POST'])
def integral():
    data = request.get_json()
    expr_str = data.get('fungsi', '')
    batas_bawah = data.get('batas_bawah')
    batas_atas = data.get('batas_atas')
    try:
        f_expr = parse_function(expr_str)
        if f_expr is None:
            return jsonify({'sukses': False, 'error': 'Gagal mengurai fungsi'})
        raw_integral = sp.integrate(f_expr, x)
        indef_expr = simplify_integral(raw_integral)
        latex_input = sp.latex(f_expr)
        result = {
            'sukses': True,
            'hasil': sp.latex(indef_expr),
            'hasil_str': str(indef_expr),
            'notasi': f"\\int {latex_input}\\,dx",
        }
        if batas_bawah and batas_atas:
            lb = sp.nsimplify(float(batas_bawah))
            ub = sp.nsimplify(float(batas_atas))
            def_val = sp.integrate(f_expr, (x, lb, ub))
            result['tentu'] = sp.latex(def_val)
            result['tentu_str'] = str(def_val)
            result['notasi'] = f"\\int_{{{sp.latex(lb)}}}^{{{sp.latex(ub)}}} {latex_input}\\,dx"
            plot_b64 = plot_integral(f_expr, indef_expr, expr_str, lb, ub, def_val)
            result['plot'] = plot_b64
        else:
            result['plot'] = plot_integral(f_expr, indef_expr, expr_str, -5, 5, sp.Integral(f_expr, x))
        return jsonify(result)
    except Exception as e:
        return jsonify({'sukses': False, 'error': str(e)})


@app.route('/api/limit', methods=['POST'])
def limit():
    data = request.get_json()
    expr_str = data.get('fungsi', '')
    titik = data.get('titik', '0')
    arah = data.get('arah', '+-')
    try:
        f_expr = parse_function(expr_str)
        if f_expr is None:
            return jsonify({'sukses': False, 'error': 'Gagal mengurai fungsi'})
        titik_num = float(titik)
        if titik_num == int(titik_num):
            titik_num = int(titik_num)
        point_sym = sp.nsimplify(titik_num)
        limit_val = sp.limit(f_expr, x, point_sym, dir=arah)
        dir_label = {'+': '^+', '-': '^-', '+-': ''}.get(arah, '')
        result = {
            'sukses': True,
            'hasil': sp.latex(limit_val),
            'hasil_str': str(limit_val),
            'notasi': f"\\lim_{{x \\to {sp.latex(point_sym)}{dir_label}}} {sp.latex(f_expr)}",
        }
        plot_b64 = plot_limit(f_expr, expr_str, point_sym, limit_val, arah)
        result['plot'] = plot_b64
        return jsonify(result)
    except Exception as e:
        return jsonify({'sukses': False, 'error': str(e)})


if __name__ == '__main__':
    import os
    port = int(os.environ.get('PORT', 5050))
    app.run(debug=True, port=port)
