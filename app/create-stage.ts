/**
 * create-stage.ts — Create a new presale stage.
 *
 * Usage:
 *   npx ts-node app/create-stage.ts <stage_id> <price_usd_6dec> <tokens_total_raw> [start_time] [end_time]
 *
 * Example (Stage 1: $0.003, 100M tokens with 6 decimals, with time window):
 *   npx ts-node app/create-stage.ts 1 3000 100000000000000 1700000000 1710000000
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
    console.log("Usage: create-stage.ts <stage_id> <price_usd_6dec> <tokens_total_raw> [start_time] [end_time]");
    console.log("Example: create-stage.ts 1 3000 100000000000000 1700000000 1710000000");
    process.exit(1);
  }

  const stageId = parseInt(args[0]);
  const priceUsd = new BN(args[1]);
  const tokensTotal = new BN(args[2]);
  const startTime = new BN(args[3] || "0");
  const endTime = new BN(args[4] || "0");

  const provider = createProvider();
  const program = getProgram(provider);
  const [icoConfigPda] = deriveIcoConfig(program.programId);
  const [stagePda] = deriveStage(program.programId, stageId);

  console.log(`Creating stage ${stageId}...`);
  console.log(`  Price:      ${priceUsd.toString()} (6-dec USD)`);
  console.log(`  Tokens:     ${tokensTotal.toString()} (raw)`);
  console.log(`  Start Time: ${startTime.toString()}`);
  console.log(`  End Time:   ${endTime.toString()}`);
  console.log(`  PDA:        ${stagePda.toBase58()}`);

  const tx = await program.methods
    .createStage(stageId, priceUsd, tokensTotal, startTime, endTime)
    .accounts({
      stage: stagePda,
    })
    .rpc();

  console.log(`\nStage ${stageId} created! tx: ${tx}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
