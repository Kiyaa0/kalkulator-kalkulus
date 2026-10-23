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
    Menghasilkan string PNG Base64 resolusi tinggi (Retina/HD) dan SVG vektor dari figur Matplotlib.
    Memastikan plt.close(fig) dan pembersihan buffer selalu dipanggil dalam blok finally untuk mencegah kebocoran memori.
    """
    buf_png = io.BytesIO()
    buf_svg = io.BytesIO()
    try:
        # DPI 220 memberikan ketajaman tinggi tanpa blur pada layar Retina / High-DPI
        fig.savefig(buf_png, format='png', dpi=220, bbox_inches='tight', facecolor=fig.get_facecolor(), edgecolor='none')
        fig.savefig(buf_svg, format='svg', bbox_inches='tight', facecolor=fig.get_facecolor(), edgecolor='none')

        png_b64 = base64.b64encode(buf_png.getvalue()).decode('utf-8')
        svg_str = buf_svg.getvalue().decode('utf-8')
        return png_b64, svg_str
    finally:
        plt.close(fig)
        buf_png.close()
        buf_svg.close()


def _get_theme_styles(theme='light'):
    """Menyediakan token warna modern dan kontras tinggi sesuai mode terang/gelap."""
    is_dark = str(theme).lower() == 'dark'
    if is_dark:
        return {
            'fig_bg': '#0c1017',
            'ax_bg': '#131924',
            'title': '#f1f5f9',
            'label': '#cbd5e1',
            'ticks': '#94a3b8',
            'grid_major': '#1e293b',
            'grid_minor': '#172033',
            'origin': '#64748b',
            'spine': '#1e2638',
            'legend_bg': '#0c1017',
            'legend_edge': '#1e293b',
            'legend_text': '#f1f5f9',
            'color_f': '#38bdf8',       # Electric Sky Blue
            'color_d': '#f43f5e',       # Vibrant Rose
            'color_ind': '#34d399',     # Vivid Emerald
            'color_area': '#a855f7',    # Vibrant Purple
            'color_pt': '#10b981',      # Emerald Point
            'color_lim': '#ef4444'      # Crimson Limit
        }
    else:
        return {
            'fig_bg': '#ffffff',
            'ax_bg': '#f8fafc',
            'title': '#0f172a',
            'label': '#334155',
            'ticks': '#475569',
            'grid_major': '#e2e8f0',
            'grid_minor': '#f1f5f9',
            'origin': '#475569',
            'spine': '#cbd5e1',
            'legend_bg': '#ffffff',
            'legend_edge': '#e2e8f0',
            'legend_text': '#0f172a',
            'color_f': '#0284c7',       # Deep Vibrant Azure
            'color_d': '#e11d48',       # Vibrant Crimson
            'color_ind': '#059669',     # Deep Emerald
            'color_area': '#8b5cf6',    # Rich Violet
            'color_pt': '#10b981',      # Vivid Green
            'color_lim': '#dc2626'      # Bold Red
        }


def _new_fig_ax(theme='light'):
    """Membuat figur Matplotlib dengan ukuran proporsional dan styling latar belakang tema."""
    cfg = _get_theme_styles(theme)
    fig, ax = plt.subplots(figsize=(8.5, 4.8), dpi=100)
    fig.set_facecolor(cfg['fig_bg'])
    ax.set_facecolor(cfg['ax_bg'])
    return fig, ax, cfg


def _style_ax(ax, cfg, title=None, xlabel=None, ylabel=None):
    """Menerapkan grid, sumbu koordinat kartesius (X=0 & Y=0), dan tipografi yang tajam."""
    if title:
        ax.set_title(title, color=cfg['title'], fontsize=12, fontweight='bold', pad=12)
    if xlabel:
        ax.set_xlabel(xlabel, color=cfg['label'], fontsize=10, fontweight='normal', labelpad=6)
    if ylabel:
        ax.set_ylabel(ylabel, color=cfg['label'], fontsize=10, fontweight='normal', labelpad=6)

    # Grid utama dan minor
    ax.grid(True, which='major', color=cfg['grid_major'], alpha=0.75, linestyle='--', linewidth=0.9, zorder=0)
    ax.minorticks_on()
    ax.grid(True, which='minor', color=cfg['grid_minor'], alpha=0.5, linestyle=':', linewidth=0.6, zorder=0)

    # Sumbu Salib Koordinat Utama Kartesius (Origin X=0 dan Y=0) agar posisi titik nol selalu jelas
    ax.axhline(0, color=cfg['origin'], linewidth=1.2, alpha=0.8, zorder=1)
    ax.axvline(0, color=cfg['origin'], linewidth=1.2, alpha=0.8, zorder=1)

    # Legenda & Tick styling
    ax.legend(facecolor=cfg['legend_bg'], edgecolor=cfg['legend_edge'], labelcolor=cfg['legend_text'],
              fontsize=9.5, framealpha=0.95, loc='best')
    ax.tick_params(colors=cfg['ticks'], labelsize=9, direction='in', length=4)
    for spine in ax.spines.values():
        spine.set_color(cfg['spine'])
        spine.set_linewidth(1.0)


def _clean_curve_for_asymptotes(y_vals):
    """
    Memfilter nilai kurva secara cerdas untuk memutus garis penghubung palsu pada asimtot vertikal
    (seperti pada fungsi 1/x, tan(x), atau rasional) dengan menyisipkan NaN saat terjadi lonjakan drastis.
    """
    y_clean = np.copy(np.asarray(y_vals, dtype=np.float64))
    y_clean[~np.isfinite(y_clean)] = np.nan

    # Deteksi perubahan tanda drastis atau lompatan asimtot
    with np.errstate(invalid='ignore'):
        diff = np.abs(np.diff(y_clean))
        sign_change = (y_clean[:-1] * y_clean[1:]) < 0
        jump_mask = (diff > 18) & (sign_change | (diff > 60))
        y_clean[:-1][jump_mask] = np.nan
    return y_clean


def _apply_ylim(ax, *y_arrays, padding=0.18, fallback=(-5, 5)):
    """
    Menyesuaikan skala sumbu Y secara adaptif menggunakan persentil robust.
    Mencegah lonjakan nilai tak hingga (asimtot) membuat grafik menjadi datar atau tak terbaca.
    """
    all_vals = []
    for arr in y_arrays:
        if arr is not None:
            arr_np = np.asarray(arr, dtype=np.float64)
            finite = arr_np[np.isfinite(arr_np)]
            if len(finite):
                all_vals.append(finite)

    if not all_vals:
        ax.set_ylim(*fallback)
        return

    combined = np.concatenate(all_vals)
    if len(combined) == 0:
        ax.set_ylim(*fallback)
        return

    # Ambil persentil ke-3 dan ke-97 untuk memangkas lonjakan asimtot ekstrem
    p_low = float(np.percentile(combined, 3))
    p_high = float(np.percentile(combined, 97))

    # Batasi rentang tampilan visual yang wajar
    min_y = max(p_low, -45.0)
    max_y = min(p_high, 45.0)

    if min_y >= max_y:
        min_y, max_y = min_y - 2.5, max_y + 2.5

    rng = max_y - min_y
    ax.set_ylim(min_y - rng * padding, max_y + rng * padding)


@contextmanager
def _managed_plot(f_expr, var=None, title=None, xlabel=None, ylabel='y', theme='light'):
    """Context manager untuk menyederhanakan siklus hidup figur dan styling plot tema."""
    if var is None:
        var = detect_var(f_expr)
    var_name = str(var)
    fig, ax, cfg = _new_fig_ax(theme=theme)
    try:
        yield fig, ax, var, var_name, cfg
        _style_ax(ax, cfg, title=title, xlabel=xlabel or var_name, ylabel=ylabel)
    except Exception:
        pass


def _plot_curve(ax, x_vals, y_vals, label, color='#0284c7', linestyle='-', linewidth=2.4, dashes=None, zorder=3):
    """Memplot kurva secara aman dengan pembersihan asimtot dan antialiasing."""
    y_clean = _clean_curve_for_asymptotes(y_vals)
    line, = ax.plot(x_vals, y_clean, label=label, color=color, linestyle=linestyle, linewidth=linewidth, zorder=zorder)
    if dashes:
        line.set_dashes(dashes)
    return line


def _plot_marked_point(ax, x_pt, y_pt, label, color='#10b981', cfg=None):
    """Memplot titik evaluasi/fokus dengan garis bantu koordinat proyeksi ke sumbu X dan Y."""
    ax.plot(x_pt, y_pt, 'o', color=color, markersize=8.5, markeredgecolor='white', markeredgewidth=1.8, label=label, zorder=5)
    line_col = cfg['origin'] if cfg else '#475569'
    ax.axvline(x_pt, color=line_col, linestyle=':', linewidth=1.1, alpha=0.7, zorder=2)
    ax.axhline(y_pt, color=line_col, linestyle=':', linewidth=1.1, alpha=0.7, zorder=2)


def plot_derivative(f_expr, derivative_expr, func_str, order, point_val=None, evaluated=None, var=None, theme='light'):
    """Plot visualisasi fungsi asli f(x) dan turunan ke-n dengan titik evaluasi."""
    resolved_var = var or detect_var(f_expr)
    title = f'Grafik Turunan ke-{order} terhadap {resolved_var}'

    with _managed_plot(f_expr, var, title=title, theme=theme) as (fig, ax, v, var_name, cfg):
        f_numpy = sympy_to_numpy(f_expr, v)
        d_numpy = sympy_to_numpy(derivative_expr, v)

        pv_num = to_float(point_val)
        x_min = (pv_num - 4.0) if pv_num is not None else -6.0
        x_max = (pv_num + 4.0) if pv_num is not None else 6.0

        x_vals = np.linspace(x_min, x_max, 500)
        y_f = f_numpy(x_vals)
        y_d = d_numpy(x_vals)

        _plot_curve(ax, x_vals, y_f, label=f'f({var_name}) = {func_str}', color=cfg['color_f'], linewidth=2.4)
        prime_label = "f" + "'" * min(order, 3) + f"({var_name})"
        _plot_curve(ax, x_vals, y_d, label=prime_label, color=cfg['color_d'], linestyle='--', linewidth=2.0, dashes=(6, 3))

        ev_num = to_float(evaluated)
        if pv_num is not None and ev_num is not None:
            _plot_marked_point(ax, pv_num, ev_num, f"f'({pv_num:.2f}) = {ev_num:.3f}", color=cfg['color_pt'], cfg=cfg)

        _apply_ylim(ax, y_f, y_d)

    return fig_to_png_svg(fig)


def plot_integral(f_expr, indef_expr, func_str, lb=None, ub=None, def_val=None, var=None, theme='light'):
    """Plot visualisasi fungsi f(x), antiturunan F(x), dan arsir area integral tentu."""
    with _managed_plot(f_expr, var, title='Grafik Fungsi dan Integral', theme=theme) as (fig, ax, v, var_name, cfg):
        f_numpy = sympy_to_numpy(f_expr, v)
        ind_numpy = sympy_to_numpy(indef_expr, v)

        lb_f = to_float(lb)
        ub_f = to_float(ub)
        is_definite = (lb_f is not None and ub_f is not None)

        if is_definite:
            margin = max((ub_f - lb_f) * 0.45, 2.0)
            x_plot = np.linspace(lb_f - margin, ub_f + margin, 500)
        else:
            x_plot = np.linspace(-6, 6, 500)

        y_f = f_numpy(x_plot)
        y_ind = ind_numpy(x_plot)

        _plot_curve(ax, x_plot, y_f, label=f'f({var_name}) = {func_str}', color=cfg['color_f'], linewidth=2.4)
        _plot_curve(ax, x_plot, y_ind, label=f'F({var_name}) + C', color=cfg['color_ind'], linestyle='--', linewidth=2.0, dashes=(6, 3))

        if is_definite:
            x_fill = np.linspace(lb_f, ub_f, 300)
            y_fill = f_numpy(x_fill)
            y_fill_clean = _clean_curve_for_asymptotes(y_fill)
            area = to_float(def_val)
            label_area = f'Luas Area = {area:.3f}' if area is not None else 'Luas Area'
            ax.fill_between(x_fill, y_fill_clean, color=cfg['color_area'], alpha=0.35, label=label_area, zorder=2)
            ax.axvline(lb_f, color=cfg['origin'], linestyle='--', linewidth=1.1, alpha=0.75, zorder=2)
            ax.axvline(ub_f, color=cfg['origin'], linestyle='--', linewidth=1.1, alpha=0.75, zorder=2)

        _apply_ylim(ax, y_f, y_ind)

    return fig_to_png_svg(fig)


def plot_limit(f_expr, func_str, point_sym, limit_val, direction='+-', var=None, theme='light'):
    """Plot visualisasi perilaku fungsi di sekitar titik limit atau asimtot tak hingga."""
    resolved_var = var or detect_var(f_expr)
    title = f'Grafik Perilaku Limit di {resolved_var} \u2192 {sp.latex(point_sym)}'

    with _managed_plot(f_expr, var, title=title, theme=theme) as (fig, ax, v, var_name, cfg):
        f_numpy = sympy_to_numpy(f_expr, v)

        if point_sym == sp.oo:
            x_vals = np.linspace(1, 25, 500)
            pt_finite = False
            pt = None
        elif point_sym == -sp.oo:
            x_vals = np.linspace(-25, -1, 500)
            pt_finite = False
            pt = None
        else:
            pt = to_float(point_sym, default=0.0)
            x_vals = np.linspace(pt - 3.5, pt + 3.5, 500)
            pt_finite = True

        y_vals = f_numpy(x_vals)
        _plot_curve(ax, x_vals, y_vals, label=f'f({var_name}) = {func_str}', color=cfg['color_f'], linewidth=2.4)

        lv_num = to_float(limit_val)
        if lv_num is not None:
            if pt_finite:
                _plot_marked_point(ax, pt, lv_num, f'Limit = {lv_num:.3f}', color=cfg['color_lim'], cfg=cfg)
            else:
                ax.axhline(lv_num, color=cfg['color_lim'], linestyle='--', linewidth=1.4, alpha=0.85, label=f'Asimtot y = {lv_num:.3f}', zorder=2)

        _apply_ylim(ax, y_vals)

    return fig_to_png_svg(fig)
