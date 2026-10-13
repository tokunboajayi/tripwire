//! Prediction-market arbitrage math. Pure functions, every case unit-tested.
//! A contract pays $1 if its side wins. Two kinds of locked-in profit:
//!  - cross: buy YES on one venue and NO on the other for the same event; exactly one pays $1.
//!  - group: on one venue, buy YES on every outcome of a mutually exclusive, exhaustive event; exactly one pays $1.
//! Either way the payout is $1 per set whatever happens, so the edge is 1 - (prices + fees). It is only locked if
//! both venues resolve the event the same way, which is why only owner-verified pairs ever trade.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Venue { Kalshi, Polymarket }

impl Venue {
    pub fn label(self) -> &'static str { match self { Venue::Kalshi => "Kalshi", Venue::Polymarket => "Polymarket" } }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side { Yes, No }

/// Best asks for one binary market (prices in dollars, 0..1; sizes in contracts). None = no offer.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct Quote { pub yes_ask: Option<f64>, pub yes_size: f64, pub no_ask: Option<f64>, pub no_size: f64, pub ts: i64 }

/// Fee schedule per venue. Kalshi: ceil(rate * C * P * (1-P)) to the cent per order. Polymarket: flat bps of notional.
#[derive(Clone, Copy, Debug, Serialize)]
pub struct Fees { pub kalshi_rate: f64, pub poly_bps: f64 }

impl Fees {
    pub fn order(&self, v: Venue, contracts: f64, price: f64) -> f64 {
        match v {
            Venue::Kalshi => (self.kalshi_rate * contracts * price * (1. - price) * 100. - 1e-9).ceil() / 100., // tolerance: 175.0000001 is 175 cents
            Venue::Polymarket => contracts * price * self.poly_bps / 1e4,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Leg { pub venue: Venue, pub market: String, pub side: Side, pub price: f64 }

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Arb {
    pub id: String, pub label: String, pub kind: String, pub legs: Vec<Leg>,
    /// contracts per leg (same on every leg, so the payout is exactly `contracts` dollars)
    pub contracts: f64, pub cost: f64, pub fees: f64, pub profit: f64, pub edge_bps: f64,
}

/// Size a set of legs: largest whole contract count that fits depth and the dollar cap, then fees and edge.
/// Returns None when nothing fits or the net edge is below `min_edge_bps`.
pub fn price_set(id: &str, label: &str, kind: &str, legs: Vec<(Leg, f64)>, fees: &Fees, max_usd: f64, min_edge_bps: f64) -> Option<Arb> {
    let unit: f64 = legs.iter().map(|(l, _)| l.price).sum();
    if unit <= 0. || unit >= 1. { return None }
    let depth = legs.iter().map(|(_, sz)| *sz).fold(f64::INFINITY, f64::min);
    let mut c = depth.min((max_usd / unit).floor()).floor();
    // fees are rounded per order, so step down until the set is still profitable after rounding
    while c >= 1. {
        let cost = unit * c;
        let fee: f64 = legs.iter().map(|(l, _)| fees.order(l.venue, c, l.price)).sum();
        let profit = c - cost - fee;
        let edge_bps = profit / (cost + fee) * 1e4;
        if edge_bps >= min_edge_bps {
            return Some(Arb { id: id.into(), label: label.into(), kind: kind.into(), legs: legs.into_iter().map(|(l, _)| l).collect(),
                contracts: c, cost: (cost * 100.).round() / 100., fees: (fee * 100.).round() / 100., profit: (profit * 100.).round() / 100., edge_bps: edge_bps.round() });
        }
        if c <= 1. { break }
        c = (c / 2.).floor(); // a smaller order pays proportionally less rounding; halve rather than crawl
    }
    None
}

/// Same event on two venues: try YES@Kalshi + NO@Polymarket and NO@Kalshi + YES@Polymarket; keep the better one.
pub fn cross(id: &str, label: &str, k_market: &str, k: &Quote, p_yes: &str, p_no: &str, py: &Quote, pn: &Quote,
             fees: &Fees, max_usd: f64, min_edge_bps: f64) -> Option<Arb> {
    let leg = |venue, market: &str, side, price| Leg { venue, market: market.into(), side, price };
    let a = match (k.yes_ask, pn.yes_ask) {
        (Some(ky), Some(pno)) => price_set(id, label, "cross", vec![(leg(Venue::Kalshi, k_market, Side::Yes, ky), k.yes_size),
            (leg(Venue::Polymarket, p_no, Side::No, pno), pn.yes_size)], fees, max_usd, min_edge_bps),
        _ => None,
    };
    let b = match (k.no_ask, py.yes_ask) {
        (Some(kn), Some(pyes)) => price_set(id, label, "cross", vec![(leg(Venue::Kalshi, k_market, Side::No, kn), k.no_size),
            (leg(Venue::Polymarket, p_yes, Side::Yes, pyes), py.yes_size)], fees, max_usd, min_edge_bps),
        _ => None,
    };
    match (a, b) { (Some(a), Some(b)) => Some(if a.profit >= b.profit { a } else { b }), (a, b) => a.or(b) }
}

/// Mutually exclusive, exhaustive outcomes on one venue: buy YES on all of them.
pub fn group(id: &str, label: &str, venue: Venue, outcomes: &[(String, Quote)], fees: &Fees, max_usd: f64, min_edge_bps: f64) -> Option<Arb> {
    if outcomes.len() < 2 { return None }
    let mut legs = vec![];
    for (m, q) in outcomes { legs.push((Leg { venue, market: m.clone(), side: Side::Yes, price: q.yes_ask? }, q.yes_size)); }
    price_set(id, label, "group", legs, fees, max_usd, min_edge_bps)
}

#[cfg(test)]
mod tests {
    use super::*;
    const F: Fees = Fees { kalshi_rate: 0.07, poly_bps: 0. };
    fn q(yes: f64, no: f64, sz: f64) -> Quote { Quote { yes_ask: Some(yes), yes_size: sz, no_ask: Some(no), no_size: sz, ts: 0 } }

    #[test]
    fn kalshi_fee_matches_schedule() {
        assert_eq!(F.order(Venue::Kalshi, 100., 0.5), 1.75);   // 0.07*100*0.25 = 1.75
        assert_eq!(F.order(Venue::Kalshi, 1., 0.5), 0.02);     // 0.0175 rounds up to 2 cents
        assert_eq!(F.order(Venue::Polymarket, 100., 0.5), 0.);
    }

    #[test]
    fn cross_arb_found_and_sized() {
        // YES 0.40 on Kalshi + NO 0.52 on Polymarket = 0.92 per $1 payout
        let a = cross("p", "x", "K", &q(0.40, 0.62, 500.), "PY", "PN", &q(0.47, 0.55, 500.), &q(0.52, 0.49, 300.), &F, 100., 100.).unwrap();
        assert_eq!((a.legs[0].side, a.legs[1].venue, a.legs[1].side), (Side::Yes, Venue::Polymarket, Side::No));
        assert_eq!(a.contracts, 108.);                         // $100 / 0.92 = 108 sets (depth 300 is not binding)
        assert!(a.profit > 4. && a.edge_bps > 400., "{a:?}");
    }

    #[test]
    fn no_arb_when_prices_add_to_a_dollar_or_more() {
        assert!(cross("p", "x", "K", &q(0.50, 0.51, 500.), "PY", "PN", &q(0.50, 0.51, 500.), &q(0.51, 0.50, 500.), &F, 100., 0.).is_none());
    }

    #[test]
    fn fees_and_min_edge_kill_thin_arbs() {
        // 0.49 + 0.49 = 0.98: 2% gross, but Kalshi's fee (~0.0175 at p≈0.5) eats most of it
        let thin = cross("p", "x", "K", &q(0.49, 0.60, 500.), "PY", "PN", &q(0.6, 0.6, 500.), &q(0.49, 0.6, 500.), &F, 100., 100.);
        assert!(thin.is_none(), "{thin:?}");
    }

    #[test]
    fn depth_limits_size() {
        let a = cross("p", "x", "K", &q(0.30, 0.8, 7.), "PY", "PN", &q(0.8, 0.8, 500.), &q(0.50, 0.6, 500.), &F, 1000., 50.).unwrap();
        assert_eq!(a.contracts, 7.);
    }

    #[test]
    fn group_arb_on_one_venue() {
        let outs: Vec<(String, Quote)> = [(0.30, 200.), (0.25, 50.), (0.33, 200.)].iter().enumerate()
            .map(|(i, (p, s))| (format!("M{i}"), Quote { yes_ask: Some(*p), yes_size: *s, ..Default::default() })).collect();
        let a = group("g", "who wins", Venue::Kalshi, &outs, &F, 100., 100.).unwrap();
        assert_eq!((a.legs.len(), a.contracts), (3, 50.));    // thinnest outcome caps it
        assert!(a.profit > 0.);
        let mut missing = outs.clone(); missing[1].1.yes_ask = None;
        assert!(group("g", "x", Venue::Kalshi, &missing, &F, 100., 0.).is_none()); // a missing outcome = no lock
    }
}
