/** Local-only validator proof. Reads devnet accounts; every transaction goes to 127.0.0.1. */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  mkdirSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import {
  Connection,
  Keypair,
  MontionsClient,
  PROGRAM_ID,
  PYTH_RECEIVER_ID,
  PublicKey,
  TOKEN_PROGRAM_ID,
  UNIT,
  snapStrike,
  ceilGrid,
  parseTokenAccount,
  ata,
  type BuiltTx,
} from "../sdk/src/index.js";
import { ROOT, loadAssetConfig, sleep, log } from "./lib.js";

const dir = mkdtempSync(join(tmpdir(), "montions-proof-"));
const solanaBin =
  process.env.SOLANA_BIN ??
  join(homedir(), ".local/share/solana/install/active_release/bin");
const validatorBin = join(solanaBin, "solana-test-validator");
const tsx = join(ROOT, "sdk/node_modules/.bin/tsx");
const rpc = "http://127.0.0.1:8899";
const conn = new Connection(rpc, "confirmed");
const client = new MontionsClient({ connection: conn });
const assets = loadAssetConfig();
const admin = Keypair.generate();
const user = Keypair.generate();
const adminPath = join(dir, "admin.json");
const userPath = join(dir, "user.json");
writeFileSync(adminPath, JSON.stringify(Array.from(admin.secretKey)), {
  mode: 0o600,
});
writeFileSync(userPath, JSON.stringify(Array.from(user.secretKey)), {
  mode: 0o600,
});
let validator: ChildProcess | undefined;
let keeper: ChildProcess | undefined;
process.on("SIGINT", () => {
  keeper?.kill("SIGINT");
  validator?.kill("SIGTERM");
  process.exitCode = 130;
});
process.on("SIGTERM", () => {
  keeper?.kill("SIGTERM");
  validator?.kill("SIGTERM");
  process.exitCode = 143;
});
const originals = new Map<string, any>();
const snapshots = join(dir, "accounts");
mkdirSync(snapshots);

async function stop() {
  if (!validator || validator.exitCode !== null) return;
  const child = validator;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve())
  );
  child.kill("SIGTERM");
  await exited;
  validator = undefined;
}
async function start(publishTime: number, restore = false, warp = false) {
  const cmd = [
    "--reset",
    "--quiet",
    "--ledger",
    join(dir, "ledger"),
    "--bpf-program",
    PROGRAM_ID.toBase58(),
    join(ROOT, "target/deploy/montions.so"),
    "--clone-upgradeable-program",
    PYTH_RECEIVER_ID.toBase58(),
    "--url",
    "devnet",
  ];
  for (const a of assets) {
    const j = structuredClone(originals.get(a.symbol));
    const b = Buffer.from(j.account.data[0], "base64");
    assert.equal(b[40], 1, "Full verification required");
    b.writeBigInt64LE(BigInt(publishTime), 93);
    b.writeBigInt64LE(BigInt(publishTime - 1), 101);
    j.account.data[0] = b.toString("base64");
    j.account.rentEpoch = 0; // JSON's u64::MAX is not representable by a JS number.
    const file = join(dir, `${a.symbol}.json`);
    writeFileSync(file, JSON.stringify(j));
    cmd.push("--account", a.priceAccount, file);
  }
  if (restore) cmd.push("--account-dir", snapshots);
  if (warp) cmd.push("--warp-slot", "10000");
  log("validator_command", { command: [validatorBin, ...cmd].join(" "), dir });
  const fd = openSync(
    join(dir, restore ? "validator-settle.log" : "validator-trade.log"),
    "w"
  );
  validator = spawn(validatorBin, cmd, {
    cwd: ROOT,
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  for (let i = 0; i < 120; i++) {
    if (validator.exitCode !== null)
      throw new Error("Validator exited; inspect " + dir);
    try {
      await conn.getLatestBlockhash();
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Validator startup timed out");
}
async function runScript(name: string, flags: string[] = []) {
  const cmd = [
    join(ROOT, name),
    "--cluster",
    "localnet",
    "--rpc",
    rpc,
    "--keypair",
    adminPath,
    ...flags,
  ];
  log("command", { command: [tsx, ...cmd].join(" ") });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(tsx, cmd, { cwd: ROOT, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${name}: exit ${code}`))
    );
  });
}
async function send(label: string, built: BuiltTx, signer = admin) {
  built.tx.sign(signer);
  const bytes = built.tx.serialize().length;
  assert.ok(bytes <= 1232);
  const simulation = await conn.simulateTransaction(built.tx);
  if (simulation.value.err)
    throw new Error(
      `${label}: ${JSON.stringify(
        simulation.value.err
      )}\n${simulation.value.logs?.join("\n")}`
    );
  assert.ok((simulation.value.unitsConsumed ?? Infinity) <= 1_400_000);
  const sig = await client.sendAndConfirm(built, [signer]);
  const tx = await conn.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  log("proof_transaction", {
    label,
    bytes,
    simulatedCU: simulation.value.unitsConsumed,
    actualCU: tx?.meta?.computeUnitsConsumed,
    sig,
  });
  return sig;
}
async function fund(k: Keypair) {
  const sig = await conn.requestAirdrop(k.publicKey, 20_000_000_000);
  const bh = await conn.getLatestBlockhash();
  await conn.confirmTransaction({ signature: sig, ...bh });
}
async function snapshot() {
  const accounts = new Map<string, any>();
  for (const programId of [PROGRAM_ID, TOKEN_PROGRAM_ID]) {
    for (const a of await conn.getProgramAccounts(programId))
      accounts.set(a.pubkey.toBase58(), a.account);
  }
  for (const k of [admin.publicKey, user.publicKey])
    accounts.set(k.toBase58(), await conn.getAccountInfo(k));
  for (const [pubkey, a] of accounts) {
    writeFileSync(
      join(snapshots, `${pubkey}.json`),
      JSON.stringify({
        pubkey,
        account: {
          lamports: a.lamports,
          data: [a.data.toString("base64"), "base64"],
          owner: a.owner.toBase58(),
          executable: a.executable,
          rentEpoch: 0,
        },
      })
    );
  }
  log("snapshot", { accounts: accounts.size });
}
async function main() {
  // Refuse to overwrite a validator already used by another job.
  try {
    await conn.getVersion();
    throw new Error("Port 8899 is already in use");
  } catch (e) {
    if ((e as Error).message.includes("already in use")) throw e;
  }
  for (const a of assets) {
    originals.set(
      a.symbol,
      JSON.parse(
        execFileSync(
          join(solanaBin, "solana"),
          ["account", a.priceAccount, "--url", "devnet", "--output", "json"],
          { encoding: "utf8" }
        )
      )
    );
  }
  await start(Math.floor(Date.now() / 1000));
  await fund(admin);
  await fund(user);
  await runScript("scripts/init-devnet.ts", ["--yes"]);
  await runScript("scripts/init-devnet.ts", ["--yes"]);
  await runScript("scripts/seed-markets.ts", [
    "--assets",
    "SOL",
    "--strikes",
    "1",
    "--yes",
  ]);
  await runScript("scripts/seed-markets.ts", [
    "--assets",
    "SOL",
    "--strikes",
    "1",
    "--yes",
  ]);
  await runScript("scripts/status.ts");
  await send(
    "faucet fresh trader",
    await client.buildFaucetTx(user.publicKey),
    user
  );
  assert.equal(await client.collateralBalance(user.publicKey), 1000n * UNIT);
  const asset = (await client.fetchAsset("SOL"))!;
  const price = (await client.fetchPrice(asset.priceAccount))!;
  const strike = snapStrike(price.priceE8, asset.strikeStep);
  const expiry = ceilGrid(Math.floor(Date.now() / 1000) + 1200);
  const first = await client.buildBuyTx({
    owner: user.publicKey,
    asset,
    strike,
    expiry,
    outcome: "yes",
    budget: 10,
  });
  assert.ok(first.needsMarket && first.refreshed);
  await send("atomic create+refresh+buy YES", first, user);
  await send(
    "buy NO",
    await client.buildBuyTx({
      owner: user.publicKey,
      asset,
      strike,
      expiry,
      outcome: "no",
      budget: 10,
    }),
    user
  );
  const live = (await client.fetchMarket(first.market))!;
  const liveBalances = await client.tokenBalances(user.publicKey);
  assert.ok(
    (liveBalances.get(live.yesMint.toBase58()) ?? 0n) > 0n &&
      (liveBalances.get(live.noMint.toBase58()) ?? 0n) > 0n
  );
  // Only local proof lowers min_tte so a short-duration book can be traded.
  const cfg = (await client.fetchConfig())!;
  await send(
    "local short market params",
    await client.buildTx(
      [
        client.ixSetParams(admin.publicKey, {
          makerParams: { ...cfg.makerParams, minTte: 0 },
        }),
      ],
      admin.publicKey
    )
  );
  const shortExpiry = ceilGrid(Math.floor(Date.now() / 1000) + 130);
  const shortBuy = await client.buildBuyTx({
    owner: user.publicKey,
    asset,
    strike,
    expiry: shortExpiry,
    outcome: "yes",
    budget: 10,
  });
  await send("short create+refresh+buy YES", shortBuy, user);
  await send(
    "short buy NO",
    await client.buildBuyTx({
      owner: user.publicKey,
      asset,
      strike,
      expiry: shortExpiry,
      outcome: "no",
      budget: 10,
    }),
    user
  );
  await send(
    "restore production params",
    await client.buildTx(
      [client.ixSetParams(admin.publicKey, { makerParams: cfg.makerParams })],
      admin.publicKey
    )
  );
  await snapshot();
  await stop();
  await start(shortExpiry + 1, true);
  const clock = await conn.getAccountInfo(
    new PublicKey("SysvarC1ock11111111111111111111111111111111")
  );
  log("validator_clock", {
    unixTimestamp: Number(clock!.data.readBigInt64LE(32)),
    expiry: shortExpiry,
  });
  // Prove the continuous loop observes expiry, resolves promptly, and exits cleanly.
  const keeperFlags = [
    join(ROOT, "keeper/keeper.ts"),
    "--cluster",
    "localnet",
    "--rpc",
    rpc,
    "--keypair",
    adminPath,
    "--no-create",
    "--interval",
    "1000",
  ];
  log("command", { command: [tsx, ...keeperFlags].join(" ") });
  keeper = spawn(tsx, keeperFlags, { cwd: ROOT, stdio: "inherit" });
  keeper.on("error", (e) => {
    console.error(e);
  });
  const deadline = shortExpiry + 60;
  while (
    (await client.fetchMarket(shortBuy.market))?.statusName !== "resolved"
  ) {
    if (keeper.exitCode !== null)
      throw new Error("Keeper exited before resolving");
    if (Math.floor(Date.now() / 1000) > deadline)
      throw new Error("Keeper missed the settlement window");
    await sleep(500);
  }
  const keeperExit = new Promise<number | null>((resolve) =>
    keeper!.once("exit", resolve)
  );
  keeper.kill("SIGINT");
  assert.equal(await keeperExit, 0);
  keeper = undefined;
  const settled = (await client.fetchMarket(shortBuy.market))!;
  assert.equal(settled.statusName, "resolved");
  const balances = await client.tokenBalances(user.publicKey);
  const yes = balances.get(settled.yesMint.toBase58()) ?? 0n;
  const no = balances.get(settled.noMint.toBase58()) ?? 0n;
  assert.ok(yes > 0n && no > 0n);
  const before = await client.collateralBalance(user.publicKey);
  await send(
    "redeem",
    await client.buildRedeemTx(user.publicKey, shortBuy.market, yes, no),
    user
  );
  const after = await client.collateralBalance(user.publicKey);
  assert.equal(after - before, (settled.outcome === 1 ? yes : no) * UNIT);
  await send(
    "maker_sweep",
    await client.buildMakerSweepTx(admin.publicKey, shortBuy.market)
  );
  const swept = (await client.fetchMarket(shortBuy.market))!;
  const seat = swept.seats.find((s) => s.owner.equals(cfg.maker));
  assert.ok(
    !seat ||
      (seat.cash +
        seat.locked +
        seat.yes +
        seat.no +
        seat.yesLocked +
        seat.noLocked ===
        0n &&
        seat.openOrders === 0)
  );
  const vault = await conn.getAccountInfo(swept.vault);
  assert.equal(parseTokenAccount(vault!.data).amount, swept.pool + swept.fees);
  await runScript("keeper/keeper.ts", ["--once", "--dry-run", "--no-create"]);
  log("local_e2e_pass", {
    market: shortBuy.market.toBase58(),
    yes,
    no,
    payout: after - before,
    dir,
  });
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    keeper?.kill("SIGTERM");
    await stop();
  });
