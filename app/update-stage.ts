/**
 * update-stage.ts — Update a stage's price, allocation, and time window.
 *
 * Usage:
 *   npx ts-node app/update-stage.ts <stage_id> <token_price_usd> <tokens_total> [start_time] [end_time]
 *
 * Example (set stage 2 to $0.006 with 60M tokens, time window):
 *   npx ts-node app/update-stage.ts 2 6000 60000000000000 1700000000 1710000000
 *
 * start_time / end_time are Unix timestamps. Use 0 for no restriction.
 */
import BN from "bn.js";
import {
  createProvider,
  getProgram,
  deriveIcoConfig,
  deriveStage,
} from "./helpers";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.log("Usage: update-stage.ts <stage_id> <token_price_usd> <tokens_total> [start_time] [end_time]");
    process.exit(1);
  }

  const stageId = parseInt(args[0]);
  const tokenPriceUsd = new BN(args[1]);
  const tokensTotal = new BN(args[2]);
  const startTime = new BN(args[3] || "0");
  const endTime = new BN(args[4] || "0");

  const provider = createProvider();
  const program = getProgram(provider);
  const [icoConfigPda] = deriveIcoConfig(program.programId);
  const [stagePda] = deriveStage(program.programId, stageId);

  console.log(`Updating stage ${stageId}: price=${tokenPriceUsd.toString()}, total=${tokensTotal.toString()}, start=${startTime.toString()}, end=${endTime.toString()}...`);

  const tx = await program.methods
    .updateStage(stageId, tokenPriceUsd, tokensTotal, startTime, endTime)
    .accounts({
      admin: provider.wallet.publicKey,
      stage: stagePda,
    })
    .rpc();

  console.log(`\nStage ${stageId} updated. tx: ${tx}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
