//! Tamper-evident audit chain: hash_n = sha256(prev | seq | ts | kind | msg).
//! Anchored on Solana by agents/solana_anchor.py.
use serde::{Deserialize, Serialize};

pub const GENESIS: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// Event kinds that go into the chain.
pub const AUDITED: [&str; 10] = ["order", "gate_block", "ai_regime", "regime", "thesis", "limits", "auto_pause", "kill", "status", "mirror"];

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Audit { pub seq: u64, pub ts: i64, pub kind: String, pub msg: String, pub hash: String }

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Anchor { pub seq: u64, pub hash: String, pub signature: String, pub cluster: String, pub ts: i64 }

pub fn audit_hash(prev: &str, seq: u64, ts: i64, kind: &str, msg: &str) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(format!("{prev}|{seq}|{ts}|{kind}|{msg}").as_bytes()))
}

/// Recompute the chain; returns the first broken seq if any.
pub fn verify_chain(a: &[Audit]) -> Result<(), u64> {
    let mut prev = GENESIS.to_string();
    for e in a {
        if audit_hash(&prev, e.seq, e.ts, &e.kind, &e.msg) != e.hash { return Err(e.seq) }
        prev = e.hash.clone();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_chain_detects_tampering() {
        let mut a = vec![];
        let mut prev = GENESIS.to_string();
        for i in 1..=5u64 {
            let h = audit_hash(&prev, i, 100 + i as i64, "order", &format!("trade {i}"));
            a.push(Audit { seq: i, ts: 100 + i as i64, kind: "order".into(), msg: format!("trade {i}"), hash: h.clone() });
            prev = h;
        }
        assert_eq!(verify_chain(&a), Ok(()));
        a[2].msg = "trade 3 (edited later)".into();
        assert_eq!(verify_chain(&a), Err(3));
    }
}
