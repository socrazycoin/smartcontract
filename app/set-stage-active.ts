/**
 * set-stage-active.ts — Activate or deactivate a presale stage.
 *
 * Usage:
 *   npx ts-node app/set-stage-active.ts <stage_id> <true|false>
 *
 * Example:
 *   npx ts-node app/set-stage-active.ts 1 true
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
    console.log("Usage: set-stage-active.ts <stage_id> <true|false>");
    process.exit(1);
  }

  const stageId = parseInt(args[0]);
  const active = args[1] === "true";

  const provider = createProvider();
  const program = getProgram(provider);
  const [icoConfigPda] = deriveIcoConfig(program.programId);
  const [stagePda] = deriveStage(program.programId, stageId);

  console.log(`Setting stage ${stageId} active=${active}...`);

  const tx = await program.methods
    .setStageActive(stageId, active)
    .accounts({
      stage: stagePda,
    })
    .rpc();

  console.log(`\nStage ${stageId} active=${active}. tx: ${tx}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
