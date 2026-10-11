//! Indicators (spec §4 step 2). Math mirrors backtest/v2.py exactly — see tests::parity.
use serde::{Deserialize, Serialize};

const NAN: f64 = f64::NAN;

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Candle { pub t: i64, pub o: f64, pub h: f64, pub l: f64, pub c: f64, pub v: f64 }

/// Per-bar indicator series.
#[derive(Clone, Default, Debug)]
pub struct Inds {
    pub atr: Vec<f64>, pub ema50: Vec<f64>, pub ema200: Vec<f64>, pub sma200: Vec<f64>, pub sma5: Vec<f64>,
    pub adx: Vec<f64>, pub rsi2: Vec<f64>, pub dch10: Vec<f64>, pub dch20: Vec<f64>, pub vol20: Vec<f64>,
    pub rv: Vec<f64>, pub atrp_rank: Vec<f64>,
}

/// Indicator values for one bar.
#[derive(Clone, Copy, Debug, Default)]
pub struct Row {
    pub atr: f64, pub ema50: f64, pub ema200: f64, pub sma200: f64, pub sma5: f64, pub adx: f64,
    pub rsi2: f64, pub dch10: f64, pub dch20: f64, pub vol20: f64, pub rv: f64, pub atrp_rank: f64,
}

impl Inds {
    pub fn row(&self, i: usize) -> Row {
        Row {
            atr: self.atr[i], ema50: self.ema50[i], ema200: self.ema200[i], sma200: self.sma200[i], sma5: self.sma5[i],
            adx: self.adx[i], rsi2: self.rsi2[i], dch10: self.dch10[i], dch20: self.dch20[i], vol20: self.vol20[i],
            rv: self.rv[i], atrp_rank: self.atrp_rank[i],
        }
    }
}

impl Row {
    /// True once the slowest indicators (200-bar averages, 90-bar rank) have warmed up.
    pub fn ready(&self) -> bool { !(self.ema200.is_nan() || self.atrp_rank.is_nan() || self.rv.is_nan() || self.sma200.is_nan()) }
}

/// pandas `.ewm(alpha, adjust=False).mean()`: seeds at first non-NaN, holds through NaN.
fn ewm(x: &[f64], a: f64) -> Vec<f64> {
    let mut p: Option<f64> = None;
    x.iter().map(|&v| {
        if v.is_nan() { return p.unwrap_or(NAN); }
        let y = p.map_or(v, |p| (1. - a) * p + a * v);
        p = Some(y);
        y
    }).collect()
}

/// pandas `.rolling(w, min_periods=minp).apply(f)`.
fn roll(x: &[f64], w: usize, minp: usize, f: impl Fn(&[f64], f64) -> f64) -> Vec<f64> {
    (0..x.len()).map(|i| {
        if x[i].is_nan() { return NAN; }
        let win: Vec<f64> = x[(i + 1).saturating_sub(w)..=i].iter().copied().filter(|v| !v.is_nan()).collect();
        if win.len() < minp { NAN } else { f(&win, x[i]) }
    }).collect()
}

fn mean(v: &[f64], _: f64) -> f64 { v.iter().sum::<f64>() / v.len() as f64 }

fn std1(v: &[f64], _: f64) -> f64 {
    let m = mean(v, 0.);
    (v.iter().map(|x| (x - m).powi(2)).sum::<f64>() / (v.len() as f64 - 1.)).sqrt()
}

/// pandas `rank(pct=True)` of the last value within its window (average ties).
fn pct_rank(v: &[f64], x: f64) -> f64 {
    let less = v.iter().filter(|&&y| y < x).count() as f64;
    let eq = v.iter().filter(|&&y| y == x).count() as f64;
    (less + (eq + 1.) / 2.) / v.len() as f64
}

/// Highest value of the previous `w` bars (excludes the current bar).
fn prev_max(x: &[f64], w: usize) -> Vec<f64> {
    (0..x.len()).map(|i| if i >= w { x[i - w..i].iter().cloned().fold(f64::MIN, f64::max) } else { NAN }).collect()
}

/// Crypto trades every day; stocks use 252.
pub fn compute(cs: &[Candle]) -> Inds { compute_ann(cs, 365.) }

pub fn compute_ann(cs: &[Candle], periods: f64) -> Inds {
    let n = cs.len();
    let c: Vec<f64> = cs.iter().map(|k| k.c).collect();
    let h: Vec<f64> = cs.iter().map(|k| k.h).collect();
    let l: Vec<f64> = cs.iter().map(|k| k.l).collect();
    let v: Vec<f64> = cs.iter().map(|k| k.v).collect();

    let tr: Vec<f64> = (0..n).map(|i| {
        if i == 0 { h[0] - l[0] } else { (h[i] - l[i]).max((h[i] - c[i - 1]).abs()).max((l[i] - c[i - 1]).abs()) }
    }).collect();
    let atr = ewm(&tr, 1. / 14.);

    let (mut pdm, mut ndm) = (vec![0.; n], vec![0.; n]);
    for i in 1..n {
        let up = h[i] - h[i - 1];
        let dn = l[i - 1] - l[i];
        if up > dn && up > 0. { pdm[i] = up }
        if dn > up && dn > 0. { ndm[i] = dn }
    }
    let (pe, ne) = (ewm(&pdm, 1. / 14.), ewm(&ndm, 1. / 14.));
    let dx: Vec<f64> = (0..n).map(|i| {
        let p = 100. * pe[i] / atr[i];
        let q = 100. * ne[i] / atr[i];
        100. * (p - q).abs() / (p + q)
    }).collect();

    let g: Vec<f64> = (0..n).map(|i| if i == 0 { NAN } else { c[i] - c[i - 1] }).collect();
    let gain: Vec<f64> = g.iter().map(|&x| if x.is_nan() { NAN } else { x.max(0.) }).collect();
    let loss: Vec<f64> = g.iter().map(|&x| if x.is_nan() { NAN } else { -(x.min(0.)) }).collect();
    let (ge, le) = (ewm(&gain, 0.5), ewm(&loss, 0.5));
    let rsi2 = (0..n).map(|i| 100. - 100. / (1. + ge[i] / le[i])).collect();

    let rets: Vec<f64> = (0..n).map(|i| if i == 0 { NAN } else { c[i] / c[i - 1] - 1. }).collect();
    let atrp: Vec<f64> = (0..n).map(|i| atr[i] / c[i]).collect();

    Inds {
        ema50: ewm(&c, 2. / 51.), ema200: ewm(&c, 2. / 201.), sma200: roll(&c, 200, 200, mean), sma5: roll(&c, 5, 5, mean),
        adx: ewm(&dx, 1. / 14.), rsi2, dch10: prev_max(&h, 10), dch20: prev_max(&h, 20), vol20: roll(&v, 20, 20, mean),
        rv: roll(&rets, 30, 30, std1).iter().map(|x| x * periods.sqrt()).collect(), atrp_rank: roll(&atrp, 90, 30, pct_rank), atr,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::regime::regime;

    /// Acceptance test 2: Rust indicators + regime == Python reference
    /// (backtest/fixtures/BTC_daily.csv, written by backtest/export_fixtures.py).
    #[test]
    fn parity() {
        let p = concat!(env!("CARGO_MANIFEST_DIR"), "/../backtest/fixtures/BTC_daily.csv");
        let Ok(txt) = std::fs::read_to_string(p) else { eprintln!("fixture missing, skipping"); return };
        let mut lines = txt.lines();
        let hdr: Vec<&str> = lines.next().unwrap().split(',').collect();
        let rows: Vec<Vec<String>> = lines.map(|l| l.split(',').map(String::from).collect()).collect();
        let col = |r: &Vec<String>, k: &str| -> f64 { r[hdr.iter().position(|h| *h == k).unwrap()].parse().unwrap_or(NAN) };
        let cs: Vec<Candle> = rows.iter()
            .map(|r| Candle { t: col(r, "t") as i64, o: col(r, "o"), h: col(r, "h"), l: col(r, "l"), c: col(r, "c"), v: col(r, "v") })
            .collect();
        let ind = compute(&cs);
        let mut checked = 0;
        for (i, r) in rows.iter().enumerate() {
            let row = ind.row(i);
            for (k, mine) in [("atr", row.atr), ("ema50", row.ema50), ("ema200", row.ema200), ("sma200", row.sma200), ("sma5", row.sma5),
                ("adx", row.adx), ("rsi2", row.rsi2), ("dch10", row.dch10), ("dch20", row.dch20), ("vol20", row.vol20), ("rv", row.rv),
                ("atrp_rank", row.atrp_rank)] {
                let py = col(r, k);
                if py.is_nan() { assert!(mine.is_nan(), "{k} row {i}: py NaN, rust {mine}"); continue }
                assert!((py - mine).abs() <= 1e-6 * py.abs().max(1.), "{k} row {i}: py {py} rust {mine}");
            }
            if row.ready() {
                let rg = serde_json::to_value(regime(cs[i].c, &row)).unwrap();
                assert_eq!(rg.as_str().unwrap(), r[hdr.len() - 1], "regime row {i}");
                checked += 1;
            }
        }
        assert!(checked > 1000, "only {checked} rows checked");
    }
}
