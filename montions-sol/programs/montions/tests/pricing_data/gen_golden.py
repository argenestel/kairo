#!/usr/bin/env python3
"""Golden tables for programs/montions/src/pricing.rs and sdk/src/pricing.ts.

Dependency-free: Python `decimal` at 110 significant digits (N(x) from the Maclaurin series of
erf, ln/sqrt from `decimal`), so the reference itself is exact to far below 1e-30.

Outputs (run from anywhere; files are written next to this script):
  golden_cdf.txt      `x_wad expected_wad`              N(x), x in WAD
  golden_digital.txt  `spot_e8 strike_e8 vol_bps tte_secs expected_wad`
                      P(S_T >= K) = N(d2), zero rate, 365-day year, spec edge conventions.
Expected values are round-half-even(p * 1e18).
"""
import math
import random
from decimal import Decimal as D, getcontext, ROUND_HALF_EVEN
from pathlib import Path

getcontext().prec = 110
WAD = 10**18
YEAR = 31_536_000
VAR_DEN = 10**8 * YEAR
U64_MAX = 2**64 - 1


def _pi():
    def arctan_inv(n):
        x = D(1) / n
        x2 = x * x
        s, t, k, sign = x, x, 1, -1
        eps = D(10) ** -105
        while True:
            t *= x2
            term = t / (2 * k + 1)
            if term < eps:
                return s
            s += sign * term
            sign, k = -sign, k + 1
    return 4 * (4 * arctan_inv(5) - arctan_inv(239))


PI = _pi()
TWO_OVER_SQRT_PI = 2 / PI.sqrt()
SQRT2 = D(2).sqrt()


def erf(z):
    # Maclaurin series; |z| <= 7.1 -> peak term ~1e21, 110 digits leave > 80 correct digits.
    z2 = z * z
    term = z  # z^(2n+1)/n!
    s = z
    n = 0
    eps = D(10) ** -100
    while True:
        n += 1
        term = -term * z2 / n
        add = term / (2 * n + 1)
        s += add
        if abs(add) < eps:
            break
    return TWO_OVER_SQRT_PI * s


def ncdf(x):
    x = D(x)
    if x <= -10:
        return D(0)
    if x >= 10:
        return D(1)
    return (1 + erf(x / SQRT2)) / 2


def to_wad(p):
    return int((p * WAD).quantize(D(1), rounding=ROUND_HALF_EVEN))


def digital(spot, strike, vol, tte):
    if strike == 0:
        return D(1)
    if spot == 0:
        return D(0)
    if tte <= 0 or vol == 0:
        return D(1) if spot >= strike else D(0)
    v = D(vol * vol * tte) / D(VAR_DEN)
    s = v.sqrt()
    d2 = ((D(spot) / D(strike)).ln() - v / 2) / s
    return ncdf(d2)


def cdf_points():
    xs = [i * 10**16 for i in range(-1000, 1001)]
    xs += [sign * (base + off) for sign in (-1, 1)
           for base in (7071067811865470000, 9 * WAD)
           for off in (-10**12, -1, 0, 1, 10**12)]
    rng = random.Random(424242)
    xs += [int(rng.uniform(-9.5, 9.5) * WAD) for _ in range(2000)]
    xs += [0, 1, -1, 10**6, -10**6]
    return xs


def digital_rows():
    rows = []
    spots = [10**6, 10**8, 15_000_000_000, 6_000_000_000_000, 10**18]
    ratios = ["0.01", "0.5", "0.9", "0.99", "0.999", "1", "1.001", "1.01", "1.1", "2", "100"]
    vols = [1, 100, 2_500, 8_000, 20_000, 50_000]
    ttes = [1, 60, 600, 3_600, 86_400, 7 * 86_400, 90 * 86_400]
    for spot in spots:
        for r in ratios:
            strike = int(D(spot) * D(r))
            if strike > U64_MAX:
                continue
            for vol in vols:
                for tte in ttes:
                    rows.append((spot, strike, vol, tte))
    rng = random.Random(20261011)
    for _ in range(2500):
        spot = int(10 ** rng.uniform(2, 19))
        strike = int(spot * math.exp(rng.uniform(-3, 3)))
        strike = max(1, min(strike, U64_MAX))
        spot = max(1, min(spot, U64_MAX))
        vol = int(10 ** rng.uniform(0, math.log10(50_000)))
        tte = int(10 ** rng.uniform(0, math.log10(90 * 86_400)))
        rows.append((spot, strike, max(vol, 1), max(tte, 1)))
    # near-the-money with tiny total vol (stress ln precision)
    for k in (10**10, 6 * 10**12, 10**18):
        for dk in (-1000, -1, 1, 1000):
            for vol, tte in ((1, 1), (1, 60), (100, 1), (8_000, 1)):
                rows.append((k + dk, k, vol, tte))
    # edges
    rows += [(0, 10**8, 8_000, 86_400), (10**8, 0, 8_000, 86_400), (0, 0, 0, 0),
             (10**8, 10**8, 0, 86_400), (2 * 10**8, 10**8, 0, 86_400), (10**8, 2 * 10**8, 0, 86_400),
             (10**8, 10**8, 8_000, 0), (10**8, 10**8, 8_000, -5), (10**8 - 1, 10**8, 8_000, -5),
             (1, U64_MAX, 50_000, 90 * 86_400), (U64_MAX, 1, 50_000, 90 * 86_400),
             (U64_MAX, U64_MAX, 50_000, 90 * 86_400), (U64_MAX, U64_MAX - 1, 1, 1),
             (10**8, 10**8, 2**32 - 1, 2**31), (10**8, 10**8, 1, 2**40)]
    return rows


def main():
    here = Path(__file__).resolve().parent
    xs = cdf_points()
    with open(here / "golden_cdf.txt", "w") as f:
        f.write("# x_wad expected_wad  (N(x), 110-digit decimal reference)\n")
        for x in xs:
            f.write(f"{x} {to_wad(ncdf(D(x) / WAD))}\n")
    rows = digital_rows()
    with open(here / "golden_digital.txt", "w") as f:
        f.write("# spot_e8 strike_e8 vol_bps tte_secs expected_wad  (P(S_T >= K), zero rate, 365d year)\n")
        for spot, strike, vol, tte in rows:
            f.write(f"{spot} {strike} {vol} {tte} {to_wad(digital(spot, strike, vol, tte))}\n")
    # self-check against math.erf
    worst = max(abs(float(ncdf(D(x) / WAD)) - 0.5 * math.erfc(-(x / WAD) / math.sqrt(2))) for x in xs[::7])
    print(f"cdf rows={len(xs)} digital rows={len(rows)} max|decimal - math.erfc|={worst:.3e}")


if __name__ == "__main__":
    main()
