/**
 * enable-stage-claim.ts — Enable or disable claiming for a stage.
 *
 * Usage:
 *   npx ts-node app/enable-stage-claim.ts <stage_id> <true|false>
 *
 * Example:
 *   npx ts-node app/enable-stage-claim.ts 1 true
 */
import {
  createProvider,
  getProgram,
  deriveIcoConfig,
  deriveStage,
} from "./helpers";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log("Usage: enable-stage-claim.ts <stage_id> <true|false>");
    process.exit(1);
  }

  const stageId = parseInt(args[0]);
  const enabled = args[1] === "true";

  const provider = createProvider();
  const program = getProgram(provider);
  const [icoConfigPda] = deriveIcoConfig(program.programId);
  const [stagePda] = deriveStage(program.programId, stageId);

  console.log(`Setting stage ${stageId} claim_enabled=${enabled}...`);

  const tx = await program.methods
    .enableStageClaim(stageId, enabled)
    .accounts({
      stage: stagePda,
    })
    .rpc();

  console.log(`\nStage ${stageId} claim_enabled=${enabled}. tx: ${tx}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
