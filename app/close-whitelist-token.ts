/**
 * close-whitelist-token.ts — Close a disabled whitelist token account to reclaim rent.
 *
 * Usage:
 *   npx ts-node app/close-whitelist-token.ts <payment_mint>
 *
 * Example:
 *   npx ts-node app/close-whitelist-token.ts Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB
 *
 * Note: The whitelist token must be disabled first.
 */
import { PublicKey } from "@solana/web3.js";
import {
  createProvider,
  getProgram,
  deriveIcoConfig,
  deriveWhitelistToken,
} from "./helpers";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log("Usage: close-whitelist-token.ts <payment_mint>");
    process.exit(1);
  }

  const paymentMint = new PublicKey(args[0]);

  const provider = createProvider();
  const program = getProgram(provider);
  const [icoConfigPda] = deriveIcoConfig(program.programId);
  const [wlPda] = deriveWhitelistToken(program.programId, paymentMint);

  console.log(`Closing whitelist token account for ${paymentMint.toBase58()}...`);

  const tx = await program.methods
    .closeWhitelistToken()
    .accountsPartial({
      whitelistToken: wlPda,
    })
    .rpc();

  console.log(`\nWhitelist token account closed. Rent reclaimed. tx: ${tx}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
