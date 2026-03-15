/**
 * buy.ts — Buy tokens from the active stage using a payment token.
 *
 * Usage:
 *   npx ts-node app/buy.ts <stage_id> <payment_mint> <payment_amount_raw>
 *
 * Example (buy with 10 USDC on stage 1):
 *   npx ts-node app/buy.ts 1 EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 10000000
 *
 * Example (buy with 0.1 SOL on stage 1 — Pyth price feed auto-derived):
 *   npx ts-node app/buy.ts 1 So11111111111111111111111111111111111111112 100000000
 *
 * Note: The user keypair is loaded from ADMIN_KEYPAIR env var (or pass USER_KEYPAIR).
 *       In production, the buyer's wallet signs the transaction on the frontend.
 */
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, NATIVE_MINT } from "@solana/spl-token";
import BN from "bn.js";
import {
  createProvider,
  getProgram,
  loadKeypair,
  deriveIcoConfig,
  deriveStage,
  deriveUserStagePurchase,
} from "./helpers";

// Pyth Push Oracle program (mainnet & devnet)
const PYTH_PUSH_ORACLE_PROGRAM_ID = new PublicKey(
  "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT"
);
// SOL/USD price feed ID (hex, without 0x prefix)
const SOL_USD_FEED_ID =
  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

/**
 * Derives the Pyth Price Feed Account PDA for a given feed, matching the
 * on-chain derivation used by the Pyth Push Oracle.
 * See: https://docs.pyth.network/price-feeds/core/push-feeds/solana
 */
function derivePythPriceFeedAccount(
  feedIdHex: string,
  shardId: number = 0
): PublicKey {
  const shardBuf = Buffer.alloc(2);
  shardBuf.writeUInt16LE(shardId);
  const feedBuf = Buffer.from(feedIdHex, "hex");
  return PublicKey.findProgramAddressSync(
    [shardBuf, feedBuf],
    PYTH_PUSH_ORACLE_PROGRAM_ID
  )[0];
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.log(
      "Usage: buy.ts <stage_id> <payment_mint> <payment_amount_raw>"
    );
    process.exit(1);
  }

  const stageId = parseInt(args[0]);
  const paymentMint = new PublicKey(args[1]);
  const paymentAmount = new BN(args[2]);
  const isSOL = paymentMint.equals(NATIVE_MINT);

  // Load user keypair (defaults to admin if USER_KEYPAIR not set)
  const userKp = loadKeypair(process.env.USER_KEYPAIR);
  const provider = createProvider(userKp);
  const program = getProgram(provider);

  const [icoConfigPda] = deriveIcoConfig(program.programId);
  const config = await program.account.icoConfig.fetch(icoConfigPda);
  const tokenMint = config.tokenMint;

  const [stagePda] = deriveStage(program.programId, stageId);
  const [purchasePda] = deriveUserStagePurchase(
    program.programId,
    userKp.publicKey,
    stageId
  );

  // For stablecoin payments, compute ATAs.
  // For SOL, pass user pubkey as mut placeholder (the account is unused on-chain).
  const userPaymentAta = isSOL
    ? userKp.publicKey
    : await getAssociatedTokenAddress(paymentMint, userKp.publicKey);

  // Payment vault: ATA of ico_config PDA for the payment mint.
  // For SOL, pass the user pubkey as placeholder (unused on-chain).
  const paymentVault = isSOL
    ? userKp.publicKey
    : await getAssociatedTokenAddress(paymentMint, icoConfigPda, true);

  // Pyth price feed account: auto-derived for SOL, placeholder for stablecoins.
  // Uses the Pyth Push Oracle Price Feed Account (shard 0) which is continuously
  // updated by the Pyth Data Association.
  // See: https://docs.pyth.network/price-feeds/core/push-feeds/solana
  const priceUpdate = isSOL
    ? derivePythPriceFeedAccount(SOL_USD_FEED_ID)
    : icoConfigPda;

  console.log(`Buying tokens...`);
  console.log(`  Stage:          ${stageId}`);
  console.log(
    `  Payment mint:   ${paymentMint.toBase58()}${isSOL ? " (SOL)" : ""}`
  );
  console.log(`  Payment amount: ${paymentAmount.toString()}`);
  console.log(`  User:           ${userKp.publicKey.toBase58()}`);
  if (isSOL) {
    console.log(`  Price feed:     ${priceUpdate.toBase58()}`);
  }

  const tx = await program.methods
    .buy(stageId, paymentAmount)
    .accounts({
      user: userKp.publicKey,
      stage: stagePda,
      paymentMint,
      tokenMint,
      userPaymentAccount: userPaymentAta,
      paymentVault,
      userStagePurchase: purchasePda,
      priceUpdate,
    })
    .rpc();

  console.log(`\nPurchase successful! tx: ${tx}`);

  const purchase = await program.account.userStagePurchase.fetch(purchasePda);
  console.log(
    `  Tokens bought (total): ${purchase.tokensBought.toString()}`
  );
  console.log(
    `  Paid USD value (total): $${(
      purchase.paidUsdValue.toNumber() / 1_000_000
    ).toFixed(6)}`
  );
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
