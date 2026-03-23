/**
 * close-stage.ts — Close a settled stage account to reclaim rent.
 *
 * Usage:
 *   npx ts-node app/close-stage.ts <stage_id>
 *
 * Example:
 *   npx ts-node app/close-stage.ts 3
 *
 * Requirements:
 *   1. Stage must be inactive (is_active = false)
 *   2. Claim must be disabled (claim_enabled = false)
 *   3. All purchased tokens must be claimed (tokens_claimed_total == tokens_sold)
 */
import {
  createProvider,
  getProgram,
  deriveIcoConfig,
  deriveStage,
} from "./helpers";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log("Usage: close-stage.ts <stage_id>");
    process.exit(1);
  }

  const stageId = parseInt(args[0]);

  const provider = createProvider();
  const program = getProgram(provider);
  const [icoConfigPda] = deriveIcoConfig(program.programId);
  const [stagePda] = deriveStage(program.programId, stageId);

  console.log(`Closing stage ${stageId} account...`);

  const tx = await program.methods
    .closeStage(stageId)
    .accounts({
      admin: provider.wallet.publicKey,
      stage: stagePda,
    })
    .rpc();

  console.log(`\nStage ${stageId} account closed. Rent reclaimed. tx: ${tx}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
