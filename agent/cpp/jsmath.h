// JavaScript number semantics for the simulator: V8's Math functions (fdlibm-derived, so results match node bit for
// bit, not just to the last ulp), Math.round, Math.max/min with NaN, Number-to-int conversions.
#pragma once
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>

namespace js {

inline uint32_t hiw(double x) { uint64_t u; std::memcpy(&u, &x, 8); return (uint32_t)(u >> 32); }
inline uint32_t low(double x) { uint64_t u; std::memcpy(&u, &x, 8); return (uint32_t)u; }
inline double mk(uint32_t hi, uint32_t lo) { uint64_t u = ((uint64_t)hi << 32) | lo; double x; std::memcpy(&x, &u, 8); return x; }
inline double setlo(double x, uint32_t lo) { return mk(hiw(x), lo); }
inline double sethi(double x, uint32_t hi) { return mk(hi, low(x)); }

// ---- exp (V8 base::ieee754::exp, from FreeBSD msun e_exp.c)
inline double exp(double x) {
  static const double one = 1.0, halF[2] = {0.5, -0.5}, o_threshold = 7.09782712893383973096e+02,
                      u_threshold = -7.45133219101941108420e+02, ln2HI[2] = {6.93147180369123816490e-01, -6.93147180369123816490e-01},
                      ln2LO[2] = {1.90821492927058770002e-10, -1.90821492927058770002e-10}, invln2 = 1.44269504088896338700e+00,
                      P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05,
                      P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08, E = 2.718281828459045,
                      huge = 1.0e+300, twom1000 = 9.33263618503218878990e-302, two1023 = 8.988465674311579539e307;
  double y, hi = 0.0, lo = 0.0, c, t, twopk;
  int32_t k = 0, xsb;
  uint32_t hx = hiw(x);
  xsb = (hx >> 31) & 1;
  hx &= 0x7FFFFFFF;
  if (hx >= 0x40862E42) {
    if (hx >= 0x7FF00000) {
      if (((hx & 0xFFFFF) | low(x)) != 0) return x + x;
      return (xsb == 0) ? x : 0.0;
    }
    if (x > o_threshold) return std::numeric_limits<double>::infinity();
    if (x < u_threshold) return 0.0;
  }
  if (hx > 0x3FD62E42) {
    if (hx < 0x3FF0A2B2) {
      if (x == 1.0) return E;
      hi = x - ln2HI[xsb]; lo = ln2LO[xsb]; k = 1 - xsb - xsb;
    } else {
      k = (int32_t)(invln2 * x + halF[xsb]);
      t = k;
      hi = x - t * ln2HI[0];
      lo = t * ln2LO[0];
    }
    x = hi - lo;
  } else if (hx < 0x3E300000) {
    if (huge + x > one) return one + x;
  } else {
    k = 0;
  }
  t = x * x;
  if (k >= -1021) twopk = mk(0x3FF00000 + (uint32_t)(k << 20), 0);
  else twopk = mk(0x3FF00000 + (uint32_t)((k + 1000) << 20), 0);
  c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k == 0) return one - ((x * c) / (c - 2.0) - x);
  y = one - ((lo - (x * c) / (2.0 - c)) - hi);
  if (k >= -1021) {
    if (k == 1024) return y * 2.0 * two1023;
    return y * twopk;
  }
  return y * twopk * twom1000;
}

// ---- log (e_log.c)
inline double log(double x) {
  static const double ln2_hi = 6.93147180369123816490e-01, ln2_lo = 1.90821492927058770002e-10, two54 = 1.80143985094819840000e+16,
                      Lg1 = 6.666666666666735130e-01, Lg2 = 3.999999999940941908e-01, Lg3 = 2.857142874366239149e-01,
                      Lg4 = 2.222219843214978396e-01, Lg5 = 1.818357216161805012e-01, Lg6 = 1.531383769920937332e-01,
                      Lg7 = 1.479819860511658591e-01;
  double hfsq, f, s, z, R, w, t1, t2, dk;
  int32_t k, hx, i, j;
  uint32_t lx;
  hx = (int32_t)hiw(x); lx = low(x);
  k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7FFFFFFF) | lx) == 0) return -std::numeric_limits<double>::infinity();
    if (hx < 0) return std::numeric_limits<double>::quiet_NaN();
    k -= 54; x *= two54; hx = (int32_t)hiw(x);
  }
  if (hx >= 0x7FF00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000FFFFF;
  i = (hx + 0x95F64) & 0x100000;
  x = sethi(x, (uint32_t)(hx | (i ^ 0x3FF00000)));
  k += (i >> 20);
  f = x - 1.0;
  if ((0x000FFFFF & (2 + hx)) < 3) {
    if (f == 0.0) {
      if (k == 0) return 0.0;
      dk = (double)k; return dk * ln2_hi + dk * ln2_lo;
    }
    R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k == 0) return f - R;
    dk = (double)k; return dk * ln2_hi - ((R - dk * ln2_lo) - f);
  }
  s = f / (2.0 + f);
  dk = (double)k;
  z = s * s;
  i = hx - 0x6147A;
  w = z * z;
  j = 0x6B851 - hx;
  t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
  t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  i |= j;
  R = t2 + t1;
  if (i > 0) {
    hfsq = 0.5 * f * f;
    if (k == 0) return f - (hfsq - s * (hfsq + R));
    return dk * ln2_hi - ((hfsq - (s * (hfsq + R) + dk * ln2_lo)) - f);
  }
  if (k == 0) return f - s * (f - R);
  return dk * ln2_hi - ((s * (f - R) - dk * ln2_lo) - f);
}

// ---- pow (fdlibm e_pow.c, V8 base::ieee754::legacy::pow)
inline double pow(double x, double y) {
  static const double bp[] = {1.0, 1.5}, dp_h[] = {0.0, 5.84962487220764160156e-01}, dp_l[] = {0.0, 1.35003920212974897128e-08},
                      zero = 0.0, one = 1.0, two = 2.0, two53 = 9007199254740992.0, huge = 1.0e300, tiny = 1.0e-300,
                      L1 = 5.99999999999994648725e-01, L2 = 4.28571428578550184252e-01, L3 = 3.33333329818377432918e-01,
                      L4 = 2.72728123808534006489e-01, L5 = 2.30660745775561754067e-01, L6 = 2.06975017800338417784e-01,
                      P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05,
                      P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08, lg2 = 6.93147180559945286227e-01,
                      lg2_h = 6.93147182464599609375e-01, lg2_l = -1.90465429995776804525e-09, ovt = 8.0085662595372944372e-17,
                      cp = 9.61796693925975554329e-01, cp_h = 9.61796700954437255859e-01, cp_l = -7.02846165095275826516e-09,
                      ivln2 = 1.44269504088896338700e+00, ivln2_h = 1.44269502162933349609e+00, ivln2_l = 1.92596299112661746887e-08;
  double z, ax, z_h, z_l, p_h, p_l, y1, t1, t2, r, s, t, u, v, w;
  int32_t i, j, k, yisint, n, hx, hy, ix, iy;
  uint32_t lx, ly;
  hx = (int32_t)hiw(x); lx = low(x); hy = (int32_t)hiw(y); ly = low(y);
  ix = hx & 0x7FFFFFFF; iy = hy & 0x7FFFFFFF;
  if ((iy | ly) == 0) return one;
  if (ix > 0x7FF00000 || ((ix == 0x7FF00000) && (lx != 0)) || iy > 0x7FF00000 || ((iy == 0x7FF00000) && (ly != 0))) return x + y;
  yisint = 0;
  if (hx < 0) {
    if (iy >= 0x43400000) yisint = 2;
    else if (iy >= 0x3FF00000) {
      k = (iy >> 20) - 0x3FF;
      if (k > 20) { j = (int32_t)(ly >> (52 - k)); if (((uint32_t)j << (52 - k)) == ly) yisint = 2 - (j & 1); }
      else if (ly == 0) { j = iy >> (20 - k); if ((j << (20 - k)) == iy) yisint = 2 - (j & 1); }
    }
  }
  if (ly == 0) {
    if (iy == 0x7FF00000) {
      if (((ix - 0x3FF00000) | lx) == 0) return std::numeric_limits<double>::quiet_NaN();
      else if (ix >= 0x3FF00000) return (hy >= 0) ? y : zero;
      else return (hy < 0) ? -y : zero;
    }
    if (iy == 0x3FF00000) { if (hy < 0) return one / x; else return x; }
    if (hy == 0x40000000) return x * x;
    if (hy == 0x3FE00000) { if (hx >= 0) return std::sqrt(x); }
  }
  ax = std::fabs(x);
  if (lx == 0) {
    if (ix == 0x7FF00000 || ix == 0 || ix == 0x3FF00000) {
      z = ax;
      if (hy < 0) z = one / z;
      if (hx < 0) {
        if (((ix - 0x3FF00000) | yisint) == 0) z = (z - z) / (z - z);
        else if (yisint == 1) z = -z;
      }
      return z;
    }
  }
  n = (hx < 0) ? 0 : 1;
  if ((n | yisint) == 0) return (x - x) / (x - x);
  s = one;
  if ((n | (yisint - 1)) == 0) s = -one;
  if (iy > 0x41E00000) {
    if (iy > 0x43F00000) {
      if (ix <= 0x3FEFFFFF) return (hy < 0) ? huge * huge : tiny * tiny;
      if (ix >= 0x3FF00000) return (hy > 0) ? huge * huge : tiny * tiny;
    }
    if (ix < 0x3FEFFFFF) return (hy < 0) ? s * huge * huge : s * tiny * tiny;
    if (ix > 0x3FF00000) return (hy > 0) ? s * huge * huge : s * tiny * tiny;
    t = ax - one;
    w = (t * t) * (0.5 - t * (0.3333333333333333333333 - t * 0.25));
    u = ivln2_h * t;
    v = t * ivln2_l - w * ivln2;
    t1 = u + v;
    t1 = setlo(t1, 0);
    t2 = v - (t1 - u);
  } else {
    double ss, s2, s_h, s_l, t_h, t_l;
    n = 0;
    if (ix < 0x00100000) { ax *= two53; n -= 53; ix = (int32_t)hiw(ax); }
    n += ((ix) >> 20) - 0x3FF;
    j = ix & 0x000FFFFF;
    ix = j | 0x3FF00000;
    if (j <= 0x3988E) k = 0;
    else if (j < 0xBB67A) k = 1;
    else { k = 0; n += 1; ix -= 0x00100000; }
    ax = sethi(ax, (uint32_t)ix);
    u = ax - bp[k];
    v = one / (ax + bp[k]);
    ss = u * v;
    s_h = ss;
    s_h = setlo(s_h, 0);
    t_h = mk((uint32_t)(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18)), 0);
    t_l = ax - (t_h - bp[k]);
    s_l = v * ((u - s_h * t_h) - s_h * t_l);
    s2 = ss * ss;
    r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
    r += s_l * (s_h + ss);
    s2 = s_h * s_h;
    t_h = 3.0 + s2 + r;
    t_h = setlo(t_h, 0);
    t_l = r - ((t_h - 3.0) - s2);
    u = s_h * t_h;
    v = s_l * t_h + t_l * ss;
    p_h = u + v;
    p_h = setlo(p_h, 0);
    p_l = v - (p_h - u);
    z_h = cp_h * p_h;
    z_l = cp_l * p_h + p_l * cp + dp_l[k];
    t = (double)n;
    t1 = (((z_h + z_l) + dp_h[k]) + t);
    t1 = setlo(t1, 0);
    t2 = z_l - (((t1 - t) - dp_h[k]) - z_h);
  }
  y1 = y;
  y1 = setlo(y1, 0);
  p_l = (y - y1) * t1 + y * t2;
  p_h = y1 * t1;
  z = p_l + p_h;
  j = (int32_t)hiw(z);
  i = (int32_t)low(z);
  if (j >= 0x40900000) {
    if (((j - 0x40900000) | i) != 0) return s * huge * huge;
    if (p_l + ovt > z - p_h) return s * huge * huge;
  } else if ((j & 0x7FFFFFFF) >= 0x4090CC00) {
    if (((j - (int32_t)0xC090CC00) | i) != 0) return s * tiny * tiny;
    if (p_l <= z - p_h) return s * tiny * tiny;
  }
  i = j & 0x7FFFFFFF;
  k = (i >> 20) - 0x3FF;
  n = 0;
  if (i > 0x3FE00000) {
    n = j + (0x00100000 >> (k + 1));
    k = ((n & 0x7FFFFFFF) >> 20) - 0x3FF;
    t = mk((uint32_t)(n & ~(0x000FFFFF >> k)), 0);
    n = ((n & 0x000FFFFF) | 0x00100000) >> (20 - k);
    if (j < 0) n = -n;
    p_h -= t;
  }
  t = p_l + p_h;
  t = setlo(t, 0);
  u = t * lg2_h;
  v = (p_l - (t - p_h)) * lg2 + t * lg2_l;
  z = u + v;
  w = v - (z - u);
  t = z * z;
  t1 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  r = (z * t1) / ((t1 - two) - (w + z * w)); // sic: V8 groups it this way (fdlibm subtracts after dividing)
  z = one - (r - z);
  j = (int32_t)hiw(z);
  j += (int32_t)((uint32_t)n << 20);
  if ((j >> 20) <= 0) z = std::scalbn(z, n);
  else z = sethi(z, (uint32_t)j);
  return s * z;
}

// ---- cos (fdlibm s_cos.c, k_cos.c, k_sin.c, e_rem_pio2.c medium range)
inline double kcos(double x, double y) {
  static const double one = 1.0, C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
                      C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
  double a, hz, z, r, qx;
  int32_t ix = (int32_t)(hiw(x) & 0x7FFFFFFF);
  if (ix < 0x3E400000) { if ((int)x == 0) return one; }
  z = x * x;
  r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3FD33333) return one - (0.5 * z - (z * r - x * y));
  if (ix > 0x3FE90000) qx = 0.28125;
  else qx = mk((uint32_t)(ix - 0x00200000), 0);
  hz = 0.5 * z - qx;
  a = one - qx;
  return a - (hz - (z * r - x * y));
}
inline double ksin(double x, double y, int iy) {
  static const double half = 0.5, S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
                      S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
  double z, r, v;
  int32_t ix = (int32_t)(hiw(x) & 0x7FFFFFFF);
  if (ix < 0x3E400000) { if ((int)x == 0) return x; }
  z = x * x;
  v = z * x;
  r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy == 0) return x + v * (S1 + z * r);
  return x - ((z * (half * y - v * r) - y) - v * S1);
}
inline int rem_pio2(double x, double* y) {
  static const int32_t npio2_hw[] = {0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB,
                                     0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB,
                                     0x403AB41B, 0x403C463A, 0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
                                     0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB, 0x404858EB, 0x404921FB};
  static const double half = 0.5, invpio2 = 6.36619772367581382433e-01, pio2_1 = 1.57079632673412561417e+00,
                      pio2_1t = 6.07710050650619224932e-11, pio2_2 = 6.07710050630396597660e-11, pio2_2t = 2.02226624879595063154e-21,
                      pio2_3 = 2.02226624871116645580e-21, pio2_3t = 8.47842766036889956997e-32;
  double z, w, t, r, fn;
  int32_t i, j, n, ix, hx;
  hx = (int32_t)hiw(x);
  ix = hx & 0x7FFFFFFF;
  if (ix <= 0x3FE921FB) { y[0] = x; y[1] = 0; return 0; }
  if (ix < 0x4002D97C) {
    if (hx > 0) {
      z = x - pio2_1;
      if (ix != 0x3FF921FB) { y[0] = z - pio2_1t; y[1] = (z - y[0]) - pio2_1t; }
      else { z -= pio2_2; y[0] = z - pio2_2t; y[1] = (z - y[0]) - pio2_2t; }
      return 1;
    } else {
      z = x + pio2_1;
      if (ix != 0x3FF921FB) { y[0] = z + pio2_1t; y[1] = (z - y[0]) + pio2_1t; }
      else { z += pio2_2; y[0] = z + pio2_2t; y[1] = (z - y[0]) + pio2_2t; }
      return -1;
    }
  }
  // medium size only (callers stay far below 2^19*pi/2)
  t = std::fabs(x);
  n = (int32_t)(t * invpio2 + half);
  fn = (double)n;
  r = t - fn * pio2_1;
  w = fn * pio2_1t;
  if (n < 32 && ix != npio2_hw[n - 1]) {
    y[0] = r - w;
  } else {
    j = ix >> 20;
    y[0] = r - w;
    i = j - (int32_t)((hiw(y[0]) >> 20) & 0x7FF);
    if (i > 16) {
      t = r; w = fn * pio2_2; r = t - w; w = fn * pio2_2t - ((t - r) - w); y[0] = r - w;
      i = j - (int32_t)((hiw(y[0]) >> 20) & 0x7FF);
      if (i > 49) { t = r; w = fn * pio2_3; r = t - w; w = fn * pio2_3t - ((t - r) - w); y[0] = r - w; }
    }
  }
  y[1] = (r - y[0]) - w;
  if (hx < 0) { y[0] = -y[0]; y[1] = -y[1]; return -n; }
  return n;
}
inline double cos_fdlibm(double x) {
  double y[2], z = 0.0;
  int32_t ix = (int32_t)(hiw(x) & 0x7FFFFFFF);
  if (ix <= 0x3FE921FB) return kcos(x, z);
  if (ix >= 0x7FF00000) return x - x;
  int n = rem_pio2(x, y);
  switch (n & 3) {
    case 0: return kcos(y[0], y[1]);
    case 1: return -ksin(y[0], y[1], 1);
    case 2: return -kcos(y[0], y[1]);
    default: return ksin(y[0], y[1], 1);
  }
}

}  // namespace js
