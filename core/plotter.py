import base64
from contextlib import contextmanager
import io
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import sympy as sp

from core.parser import detect_var, to_float


def sympy_to_numpy(expr, var=None):
    """Mengonversi ekspresi SymPy menjadi fungsi callable numpy dengan lambdify."""
    if var is None:
        var = detect_var(expr)
    return sp.lambdify(var, expr, 'numpy')


def fig_to_png_svg(fig):
    """
    Menghasilkan string PNG Base64 dan SVG dari figur Matplotlib.
    Memastikan plt.close(fig) selalu dipanggil dalam blok finally untuk mencegah kebocoran memori.
    """
    try:
        buf_png = io.BytesIO()
        fig.savefig(buf_png, format='png', dpi=120, bbox_inches='tight', facecolor=fig.get_facecolor())
        buf_svg = io.BytesIO()
        fig.savefig(buf_svg, format='svg', bbox_inches='tight', facecolor=fig.get_facecolor())

        png_b64 = base64.b64encode(buf_png.getvalue()).decode('utf-8')
        svg_str = buf_svg.getvalue().decode('utf-8')
        return png_b64, svg_str
    finally:
        plt.close(fig)


def _new_fig_ax():
    fig, ax = plt.subplots(figsize=(8, 4.5))
    fig.set_facecolor('#1e293b')
    ax.set_facecolor('#0f172a')
    return fig, ax


def _style_ax(ax, title=None, xlabel=None, ylabel=None):
    if title:
        ax.set_title(title, color='#e2e8f0', fontsize=11, pad=10)
    if xlabel:
        ax.set_xlabel(xlabel, color='#94a3b8')
    if ylabel:
        ax.set_ylabel(ylabel, color='#94a3b8')
    ax.grid(True, which='major', color='#475569', alpha=0.55, linestyle='--', linewidth=0.9, zorder=0)
    ax.minorticks_on()
    ax.grid(True, which='minor', color='#334155', alpha=0.28, linestyle=':', linewidth=0.7, zorder=0)
    ax.legend(facecolor='#1e293b', edgecolor='#334155', labelcolor='#e2e8f0', fontsize=9, framealpha=0.9)
    ax.tick_params(colors='#94a3b8', labelsize=9, direction='in', length=4)
    for spine in ax.spines.values():
        spine.set_color('#475569')
        spine.set_linewidth(1.0)


def _apply_ylim(ax, *y_arrays, padding=0.15, fallback=(-5, 5), abs_max=1e5):
    all_vals = []
    for arr in y_arrays:
        if arr is not None:
            arr_np = np.asarray(arr, dtype=np.float64)
            finite = arr_np[np.isfinite(arr_np)]
            if len(finite):
                finite = finite[np.abs(finite) < abs_max]
                if len(finite):
                    all_vals.append(finite)
    if not all_vals:
        ax.set_ylim(*fallback)
        return
    combined = np.concatenate(all_vals)
    if len(combined) == 0:
        ax.set_ylim(*fallback)
        return
    min_y, max_y = float(combined.min()), float(combined.max())
    if min_y == max_y:
        ax.set_ylim(min_y - 2, max_y + 2)
        return
    rng = max_y - min_y
    ax.set_ylim(min_y - rng * padding, max_y + rng * padding)


@contextmanager
def _managed_plot(f_expr, var=None, title=None, xlabel=None, ylabel='y'):
    """Context manager untuk menyederhanakan siklus hidup figur dan styling plot."""
    if var is None:
        var = detect_var(f_expr)
    var_name = str(var)
    fig, ax = _new_fig_ax()
    try:
        yield fig, ax, var, var_name
        _style_ax(ax, title=title, xlabel=xlabel or var_name, ylabel=ylabel)
    except Exception:
        pass


def _plot_curve(ax, x_vals, y_vals, label, color='#38bdf8', linestyle='-', linewidth=2.2, dashes=None, zorder=3):
    """Memplot kurva secara aman dengan menyaring nilai tak terdefinisi atau tak hingga."""
    fin = np.isfinite(y_vals)
    line, = ax.plot(x_vals[fin], y_vals[fin], label=label, color=color, linestyle=linestyle, linewidth=linewidth, zorder=zorder)
    if dashes:
        line.set_dashes(dashes)
    return line


def _plot_marked_point(ax, x_pt, y_pt, label, color='#22c55e'):
    """Memplot titik fokus evaluasi dengan garis bantu koordinat vertikal & horizontal."""
    ax.plot(x_pt, y_pt, 'o', color=color, markersize=9, markeredgecolor='white', markeredgewidth=1.2, label=label, zorder=4)
    ax.axvline(x_pt, color='#475569', linestyle=':', linewidth=0.9, alpha=0.65, zorder=2)
    ax.axhline(y_pt, color='#475569', linestyle=':', linewidth=0.8, alpha=0.55, zorder=2)


def plot_derivative(f_expr, derivative_expr, func_str, order, point_val=None, evaluated=None, var=None):
    """Plot visualisasi fungsi asli f(x) dan turunan ke-n dengan titik evaluasi."""
    resolved_var = var or detect_var(f_expr)
    title = f'Turunan ke-{order} terhadap {resolved_var}'

    with _managed_plot(f_expr, var, title=title) as (fig, ax, v, var_name):
        f_numpy = sympy_to_numpy(f_expr, v)
        d_numpy = sympy_to_numpy(derivative_expr, v)

        pv_num = to_float(point_val)
        x_min = (pv_num - 3.5) if pv_num is not None else -5
        x_max = (pv_num + 3.5) if pv_num is not None else 5

        x_vals = np.linspace(x_min, x_max, 450)
        y_f = f_numpy(x_vals)
        y_d = d_numpy(x_vals)

        _plot_curve(ax, x_vals, y_f, label=f'f({var_name}) = {func_str}', color='#38bdf8')
        prime_label = "f" + "'" * min(order, 3) + f"({var_name})"
        _plot_curve(ax, x_vals, y_d, label=prime_label, color='#f87171', linestyle='--', linewidth=2.0, dashes=(6, 3))

        ev_num = to_float(evaluated)
        if pv_num is not None and ev_num is not None:
            _plot_marked_point(ax, pv_num, ev_num, f"f'({pv_num:.2f}) = {ev_num:.3f}", color='#22c55e')

        _apply_ylim(ax, y_f, y_d)

    return fig_to_png_svg(fig)


def plot_integral(f_expr, indef_expr, func_str, lb=None, ub=None, def_val=None, var=None):
    """Plot visualisasi fungsi f(x), antiturunan F(x), dan arsir area integral tentu."""
    with _managed_plot(f_expr, var, title='Grafik Fungsi dan Integral') as (fig, ax, v, var_name):
        f_numpy = sympy_to_numpy(f_expr, v)
        ind_numpy = sympy_to_numpy(indef_expr, v)

        lb_f = to_float(lb)
        ub_f = to_float(ub)
        is_definite = (lb_f is not None and ub_f is not None)

        if is_definite:
            margin = max((ub_f - lb_f) * 0.4, 1.5)
            x_plot = np.linspace(lb_f - margin, ub_f + margin, 450)
        else:
            x_plot = np.linspace(-5, 5, 450)

        y_f = f_numpy(x_plot)
        y_ind = ind_numpy(x_plot)

        _plot_curve(ax, x_plot, y_f, label=f'f({var_name}) = {func_str}', color='#38bdf8')
        _plot_curve(ax, x_plot, y_ind, label=f'F({var_name}) + C', color='#4ade80', linestyle='--', linewidth=2.0, dashes=(6, 3))

        if is_definite:
            x_fill = np.linspace(lb_f, ub_f, 250)
            y_fill = f_numpy(x_fill)
            area = to_float(def_val)
            label_area = f'Luas Area = {area:.3f}' if area is not None else 'Luas Area'
            ax.fill_between(x_fill, y_fill, color='#a855f7', alpha=0.32, label=label_area, zorder=2)
            ax.axvline(lb_f, color='#94a3b8', linestyle='--', linewidth=1.0, alpha=0.65, zorder=2)
            ax.axvline(ub_f, color='#94a3b8', linestyle='--', linewidth=1.0, alpha=0.65, zorder=2)

        _apply_ylim(ax, y_f, y_ind)

    return fig_to_png_svg(fig)


def plot_limit(f_expr, func_str, point_sym, limit_val, direction='+-', var=None):
    """Plot visualisasi perilaku fungsi di sekitar titik limit atau asimtot tak hingga."""
    resolved_var = var or detect_var(f_expr)
    title = f'Limit di {resolved_var} \u2192 {sp.latex(point_sym)}'

    with _managed_plot(f_expr, var, title=title) as (fig, ax, v, var_name):
        f_numpy = sympy_to_numpy(f_expr, v)

        if point_sym == sp.oo:
            x_vals = np.linspace(1, 25, 450)
            pt_finite = False
            pt = None
        elif point_sym == -sp.oo:
            x_vals = np.linspace(-25, -1, 450)
            pt_finite = False
            pt = None
        else:
            pt = to_float(point_sym, default=0.0)
            x_vals = np.linspace(pt - 2.5, pt + 2.5, 450)
            pt_finite = True

        y_vals = f_numpy(x_vals)
        _plot_curve(ax, x_vals, y_vals, label=f'f({var_name}) = {func_str}', color='#38bdf8')

        lv_num = to_float(limit_val)
        if lv_num is not None:
            if pt_finite:
                _plot_marked_point(ax, pt, lv_num, f'Limit = {lv_num:.3f}', color='#ef4444')
            else:
                ax.axhline(lv_num, color='#f87171', linestyle='--', linewidth=1.2, alpha=0.8, label=f'Asimtot y = {lv_num:.3f}', zorder=2)

        _apply_ylim(ax, y_vals)

    return fig_to_png_svg(fig)
