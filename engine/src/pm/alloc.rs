//! Capital allocator ("where should the money be?"). Pure function, unit-tested.
//! Each venue earns a score from the profit it actually produced plus the profit it had to skip for lack of cash.
//! Target weights follow the scores (with a floor and a cap so no venue is starved or over-concentrated), and the
//! output is a list of suggested transfers. Money is NOT moved automatically: bank / USDC transfers between brokers
//! have no safe API and take hours to days, so the owner moves it; within a venue the engine uses what is there.
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct VenueBook { pub venue: String, pub balance: f64, pub realized: f64, pub missed: f64 }

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Transfer { pub from: String, pub to: String, pub usd: f64 }

#[derive(Clone, Debug, Serialize)]
pub struct Plan { pub weights: Vec<(String, f64)>, pub transfers: Vec<Transfer> }

/// `floor`/`cap`: min/max weight per venue. Transfers smaller than `min_usd` or within `band` of target are skipped.
pub fn allocate(books: &[VenueBook], floor: f64, cap: f64, min_usd: f64, band: f64) -> Plan {
    let total: f64 = books.iter().map(|b| b.balance).sum();
    let n = books.len() as f64;
    if books.is_empty() || total <= 0. { return Plan { weights: vec![], transfers: vec![] } }
    let scores: Vec<f64> = books.iter().map(|b| (b.realized + b.missed).max(0.)).collect();
    let sum: f64 = scores.iter().sum();
    let raw: Vec<f64> = if sum <= 0. { vec![1. / n; books.len()] } else { scores.iter().map(|s| s / sum).collect() };
    // water-filling: pin venues that hit the floor or cap, share what's left among the rest in proportion to score
    let k = books.len();
    let (mut w, mut pinned) = (vec![0.; k], vec![false; k]);
    loop {
        let rest = 1. - (0..k).filter(|&i| pinned[i]).map(|i| w[i]).sum::<f64>();
        let free: Vec<usize> = (0..k).filter(|&i| !pinned[i]).collect();
        if free.is_empty() { break }
        let free_raw: f64 = free.iter().map(|&i| raw[i]).sum();
        for &i in &free { w[i] = if free_raw > 0. { raw[i] / free_raw * rest } else { rest / free.len() as f64 }; }
        let mut changed = false;
        for &i in &free {
            if w[i] > cap { w[i] = cap; pinned[i] = true; changed = true } else if w[i] < floor { w[i] = floor; pinned[i] = true; changed = true }
        }
        if !changed { break }
    }
    let target: Vec<f64> = w.iter().map(|x| x * total).collect();
    // greedy: surplus venues pay deficit venues, largest first
    let mut surplus: Vec<(usize, f64)> = books.iter().enumerate().map(|(i, b)| (i, b.balance - target[i])).filter(|(_, d)| *d > band * total).collect();
    let mut deficit: Vec<(usize, f64)> = books.iter().enumerate().map(|(i, b)| (i, target[i] - b.balance)).filter(|(_, d)| *d > band * total).collect();
    surplus.sort_by(|a, b| b.1.total_cmp(&a.1));
    deficit.sort_by(|a, b| b.1.total_cmp(&a.1));
    let mut transfers = vec![];
    let (mut i, mut j) = (0, 0);
    while i < surplus.len() && j < deficit.len() {
        let amt = surplus[i].1.min(deficit[j].1);
        if amt >= min_usd {
            transfers.push(Transfer { from: books[surplus[i].0].venue.clone(), to: books[deficit[j].0].venue.clone(), usd: (amt / 10.).floor() * 10. });
        }
        surplus[i].1 -= amt; deficit[j].1 -= amt;
        if surplus[i].1 <= 1e-9 { i += 1 }
        if deficit[j].1 <= 1e-9 { j += 1 }
    }
    Plan { weights: books.iter().zip(w).map(|(b, x)| (b.venue.clone(), (x * 1000.).round() / 1000.)).collect(), transfers }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn b(v: &str, bal: f64, r: f64, m: f64) -> VenueBook { VenueBook { venue: v.into(), balance: bal, realized: r, missed: m } }

    #[test]
    fn money_follows_the_edge_within_floor_and_cap() {
        let p = allocate(&[b("crypto", 500., 0., 0.), b("kalshi", 250., 30., 40.), b("polymarket", 250., 0., 10.)], 0.1, 0.6, 25., 0.05);
        let w: Vec<f64> = p.weights.iter().map(|x| x.1).collect();
        assert!((w.iter().sum::<f64>() - 1.).abs() < 0.01);
        assert!(w[1] > w[2] && w[2] >= w[0] && w[0] >= 0.09, "{w:?}");   // kalshi earns most; crypto keeps its floor
        assert!(w.iter().all(|x| *x <= 0.6 + 1e-3));
        assert!(p.transfers.iter().any(|t| t.from == "crypto" && t.to == "kalshi"), "{:?}", p.transfers);
    }

    #[test]
    fn no_signal_means_equal_split_and_small_moves_are_skipped() {
        let p = allocate(&[b("a", 340., 0., 0.), b("b", 330., 0., 0.), b("c", 330., 0., 0.)], 0.1, 0.6, 25., 0.05);
        assert!(p.transfers.is_empty(), "{:?}", p.transfers);
        assert!(allocate(&[], 0.1, 0.6, 25., 0.05).weights.is_empty());
    }
}
