/**
 * status.ts — Fetch and display current ICO state from on-chain data.
 *
 * Usage:
 *   npx ts-node app/status.ts [stage_id]
 *
 * If stage_id is provided, also shows that stage's details.
 * If not, shows ICO config and all stages up to stage_count.
 */
import { PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import {
  createProvider,
  getProgram,
  deriveIcoConfig,
  deriveStage,
} from "./helpers";

async function main() {
  const provider = createProvider();
  const program = getProgram(provider);
  const [icoConfigPda] = deriveIcoConfig(program.programId);

  // Fetch ICO Config
  const config = await program.account.icoConfig.fetch(icoConfigPda);
  const vaultAta = await getAssociatedTokenAddress(
    config.tokenMint,
    icoConfigPda,
    true
  );
  const vaultAccount = await getAccount(provider.connection, vaultAta);

  console.log("=== ICO Config ===");
  console.log(`  Admin:           ${config.admin.toBase58()}`);
  console.log(`  Token Mint:      ${config.tokenMint.toBase58()}`);
  console.log(`  Total Raised:    $${(config.totalRaisedUsd.toNumber() / 1_000_000).toFixed(6)}`);
  console.log(`  Stage Count:     ${config.stageCount}`);
  console.log(`  Current Stage:   ${config.currentStage === 255 ? "None" : config.currentStage}`);
  console.log(`  Paused:          ${config.paused}`);
  console.log(`  Vault Balance:   ${Number(vaultAccount.amount)} (raw)`);
  console.log();

  // Determine which stages to show
  const requestedStage = process.argv[2] ? parseInt(process.argv[2]) : null;
  const stageIds: number[] = [];

  if (requestedStage !== null) {
    stageIds.push(requestedStage);
  } else {
    // Show all stages 1..stage_count (best effort with IDs 0..stage_count)
    for (let i = 0; i <= config.stageCount + 1; i++) {
      stageIds.push(i);
    }
  }

  for (const sid of stageIds) {
    try {
      const [stagePda] = deriveStage(program.programId, sid);
      const stage = await program.account.stage.fetch(stagePda);

      const remaining = stage.tokensTotal.sub(stage.tokensSold);
      const pctSold =
        stage.tokensTotal.toNumber() > 0
          ? ((stage.tokensSold.toNumber() / stage.tokensTotal.toNumber()) * 100).toFixed(2)
          : "0.00";

      console.log(`=== Stage ${stage.stageId} ===`);
      console.log(`  Price:         $${(stage.tokenPriceUsd.toNumber() / 1_000_000).toFixed(6)}`);
      console.log(`  Tokens Total:  ${stage.tokensTotal.toString()}`);
      console.log(`  Tokens Sold:   ${stage.tokensSold.toString()} (${pctSold}%)`);
      console.log(`  Remaining:     ${remaining.toString()}`);
      console.log(`  Active:        ${stage.isActive}`);
      console.log(`  Claim Enabled: ${stage.claimEnabled}`);
      console.log();
    } catch {
      // Stage doesn't exist at this ID, skip
    }
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
