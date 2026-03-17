/**
 * transfer-admin.ts — Transfer admin role directly.
 *
 * Usage:
 *   npx ts-node app/transfer-admin.ts <new_admin_pubkey>
 *
 * The current admin transfers the role to a new admin in a single step.
 * Requires ADMIN_KEYPAIR to be the current admin.
 */
import { PublicKey } from "@solana/web3.js";
import {
  createProvider,
  getProgram,
  deriveIcoConfig,
} from "./helpers";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log("Usage: transfer-admin.ts <new_admin_pubkey>");
    process.exit(1);
  }

  const newAdmin = new PublicKey(args[0]);
  const provider = createProvider();
  const program = getProgram(provider);
  const [icoConfigPda] = deriveIcoConfig(program.programId);

  const config = await program.account.icoConfig.fetch(icoConfigPda);

  console.log("Transferring admin role...");
  console.log(`  Current admin:  ${config.admin.toBase58()}`);
  console.log(`  New admin:      ${newAdmin.toBase58()}`);

  const tx = await program.methods
    .transferAdmin(newAdmin)
    .accounts({
      admin: provider.wallet.publicKey,
    })
    .rpc();

  console.log(`\nAdmin transferred! tx: ${tx}`);
  console.log(`New admin: ${newAdmin.toBase58()}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
