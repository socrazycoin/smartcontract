/**
 * initialize-ico.ts — Initialize the ICO config and vault on-chain.
 *
 * Usage:
 *   npx ts-node app/initialize-ico.ts
 *
 * Required .env:
 *   ADMIN_KEYPAIR, CLUSTER_URL, TOKEN_MINT
 */
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  createProvider,
  getProgram,
  getTokenMint,
  deriveIcoConfig,
} from "./helpers";

async function main() {
  const provider = createProvider();
  const program = getProgram(provider);
  const tokenMint = getTokenMint();

  const [icoConfigPda] = deriveIcoConfig(program.programId);
  const vaultAta = await getAssociatedTokenAddress(
    tokenMint,
    icoConfigPda,
    true
  );

  console.log("Initializing ICO...");
  console.log(`  Admin:     ${provider.wallet.publicKey.toBase58()}`);
  console.log(`  Token:     ${tokenMint.toBase58()}`);
  console.log(`  Config:    ${icoConfigPda.toBase58()}`);
  console.log(`  Vault:     ${vaultAta.toBase58()}`);

  const tx = await program.methods
    .initializeIco()
    .accounts({
      tokenMint,
    })
    .rpc();

  console.log(`\nICO initialized! tx: ${tx}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
