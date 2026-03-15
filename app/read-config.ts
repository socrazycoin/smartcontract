/**
 * read-config.ts — Fetch and display the IcoConfig account in detail.
 *
 * Usage:
 *   npx ts-node app/read-config.ts
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
} from "./helpers";

async function main() {
  const provider = createProvider();
  const program = getProgram(provider);
  const [icoConfigPda] = deriveIcoConfig(program.programId);

  const config = await program.account.icoConfig.fetch(icoConfigPda);

  const vaultAta = await getAssociatedTokenAddress(
    config.tokenMint,
    icoConfigPda,
    true
  );

  let vaultBalance = "N/A (vault not funded)";
  try {
    const vaultAccount = await getAccount(provider.connection, vaultAta);
    vaultBalance = vaultAccount.amount.toString();
  } catch {
    // vault ATA may not exist yet
  }

  const pendingAdmin =
    config.pendingAdmin && !config.pendingAdmin.equals(PublicKey.default)
      ? config.pendingAdmin.toBase58()
      : "None";

  console.log("=== ICO Config ===");
  console.log(`  PDA:             ${icoConfigPda.toBase58()}`);
  console.log(`  Admin:           ${config.admin.toBase58()}`);
  console.log(`  Pending Admin:   ${pendingAdmin}`);
  console.log(`  Token Mint:      ${config.tokenMint.toBase58()}`);
  console.log(`  Total Raised:    $${(config.totalRaisedUsd.toNumber() / 1_000_000).toFixed(6)}`);
  console.log(`  Stage Count:     ${config.stageCount}`);
  console.log(`  Current Stage:   ${config.currentStage === 255 ? "None" : config.currentStage}`);
  console.log(`  Paused:          ${config.paused}`);
  console.log(`  Vault ATA:       ${vaultAta.toBase58()}`);
  console.log(`  Vault Balance:   ${vaultBalance} (raw token units)`);
  console.log(`  Bump:            ${config.bump}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
