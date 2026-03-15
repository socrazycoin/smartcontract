/**
 * set-whitelist-token.ts — Add/update a whitelisted payment token.
 *
 * Usage:
 *   npx ts-node app/set-whitelist-token.ts <mint> <true|false>
 *
 * Example (whitelist USDC):
 *   npx ts-node app/set-whitelist-token.ts EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v true
 */
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  createProvider,
  getProgram,
  deriveIcoConfig,
  deriveWhitelistToken,
} from "./helpers";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log("Usage: set-whitelist-token.ts <mint> <true|false>");
    process.exit(1);
  }

  const mint = new PublicKey(args[0]);
  const enabled = args[1] === "true";

  const provider = createProvider();
  const program = getProgram(provider);
  const [icoConfigPda] = deriveIcoConfig(program.programId);
  const [wlPda] = deriveWhitelistToken(program.programId, mint);
  const paymentVault = await getAssociatedTokenAddress(mint, icoConfigPda, true);

  console.log(`Setting whitelist token...`);
  console.log(`  Mint:          ${mint.toBase58()}`);
  console.log(`  Enabled:       ${enabled}`);
  console.log(`  Payment Vault: ${paymentVault.toBase58()}`);

  const tx = await program.methods
    .setWhitelistToken(enabled)
    .accounts({
      paymentMint: mint,
    })
    .rpc();

  console.log(`\nWhitelist token set! tx: ${tx}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
