/**
 * toggle-pause.ts — Pause or unpause the contract.
 *
 * Usage:
 *   npx ts-node app/toggle-pause.ts <true|false>
 *
 * Example:
 *   npx ts-node app/toggle-pause.ts true
 */
import {
  createProvider,
  getProgram,
  deriveIcoConfig,
} from "./helpers";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log("Usage: toggle-pause.ts <true|false>");
    process.exit(1);
  }

  const paused = args[0] === "true";

  const provider = createProvider();
  const program = getProgram(provider);
  const [icoConfigPda] = deriveIcoConfig(program.programId);

  console.log(`Setting paused=${paused}...`);

  const tx = await program.methods
    .togglePause(paused)
    .accounts({
      admin: provider.wallet.publicKey,
    })
    .rpc();

  console.log(`\nContract paused=${paused}. tx: ${tx}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
