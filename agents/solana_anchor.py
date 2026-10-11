"""Anchor Vantrel's audit-chain head on Solana (devnet by default) as a Memo transaction.
Anyone can later recompute the chain from /v1/audit and compare it to the memo on-chain: edits to past
trades or AI decisions change every later hash, so they can't be hidden. No keys needed on devnet."""
import os, json, time, base64, pathlib, httpx
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.instruction import Instruction, AccountMeta
from solders.message import Message
from solders.transaction import Transaction
from solders.hash import Hash

RPC = os.getenv("SOLANA_RPC", "https://api.devnet.solana.com")
CLUSTER = os.getenv("SOLANA_CLUSTER", "devnet")
MEMO = Pubkey.from_string("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")
KEYFILE = pathlib.Path(os.getenv("SOLANA_KEYPAIR_FILE", pathlib.Path(__file__).parent / ".solana-keypair.json"))
http = httpx.Client(timeout=30)

def rpc(method, params=None):
    r = http.post(RPC, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}).json()
    if "error" in r: raise RuntimeError(f"{method}: {r['error'].get('message')}")
    return r["result"]

def keypair() -> Keypair:
    if os.getenv("SOLANA_KEYPAIR"): return Keypair.from_bytes(bytes(json.loads(os.environ["SOLANA_KEYPAIR"])))
    if KEYFILE.exists(): return Keypair.from_bytes(bytes(json.loads(KEYFILE.read_text())))
    kp = Keypair(); KEYFILE.write_text(json.dumps(list(bytes(kp)))); return kp

def ensure_funds(kp: Keypair) -> bool:
    if rpc("getBalance", [str(kp.pubkey())])["value"] >= 100_000: return True
    if CLUSTER != "devnet": print("Fund", kp.pubkey(), "to anchor on", CLUSTER); return False
    try:
        sig = rpc("requestAirdrop", [str(kp.pubkey()), 1_000_000_000])
        for _ in range(30):
            st = rpc("getSignatureStatuses", [[sig]])["value"][0]
            if st and st.get("confirmationStatus") in ("confirmed", "finalized"): return True
            time.sleep(1)
    except Exception as e:
        print(f"Devnet airdrop failed ({e}). Get free devnet SOL at https://faucet.solana.com for {kp.pubkey()}")
    return rpc("getBalance", [str(kp.pubkey())])["value"] >= 100_000

def anchor(seq: int, digest: str) -> str:
    kp = keypair()
    if not ensure_funds(kp): raise RuntimeError(f"no SOL on {kp.pubkey()}")
    bh = Hash.from_string(rpc("getLatestBlockhash", [{"commitment": "finalized"}])["value"]["blockhash"])
    ix = Instruction(MEMO, f"vantrel:{seq}:{digest}".encode(), [AccountMeta(kp.pubkey(), True, True)])
    tx = Transaction([kp], Message.new_with_blockhash([ix], kp.pubkey(), bh), bh)
    return rpc("sendTransaction", [base64.b64encode(bytes(tx)).decode(), {"encoding": "base64", "preflightCommitment": "confirmed"}])

def anchor_round(api: str, headers: dict):
    head = httpx.get(f"{api}/internal/audit/head", headers=headers, timeout=15).json()
    if not head["seq"] or head["seq"] == head["last_anchored_seq"]: return
    sig = anchor(head["seq"], head["hash"])
    httpx.post(f"{api}/internal/audit/anchor", headers=headers, timeout=15,
               json={"seq": head["seq"], "hash": head["hash"], "signature": sig, "cluster": CLUSTER}).raise_for_status()
    print(f"anchored seq {head['seq']} on {CLUSTER}: {sig}")

if __name__ == "__main__":
    import envload  # noqa: F401
    print("anchor wallet:", keypair().pubkey())
    anchor_round(os.getenv("VANTREL_API", "http://127.0.0.1:8080"), {"x-internal-token": os.getenv("INTERNAL_TOKEN", "change-me")})
