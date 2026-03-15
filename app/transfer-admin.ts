/**
 * transfer-admin.ts — Transfer admin role (2-step process).
 *
 * Usage:
 *   npx ts-node app/transfer-admin.ts nominate <new_admin_pubkey>
 *   npx ts-node app/transfer-admin.ts accept
 *
 * Step 1 (nominate): The current admin nominates a new admin.
 *   Requires ADMIN_KEYPAIR to be the current admin.
 *
 * Step 2 (accept): The nominated admin accepts the role.
 *   Requires ADMIN_KEYPAIR to be the nominated (pending) admin.
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
    console.log("Usage:");
    console.log("  transfer-admin.ts nominate <new_admin_pubkey>");
    console.log("  transfer-admin.ts accept");
    process.exit(1);
  }

  const command = args[0];
  const provider = createProvider();
  const program = getProgram(provider);
  const [icoConfigPda] = deriveIcoConfig(program.programId);

  if (command === "nominate") {
    if (args.length < 2) {
      console.log("Usage: transfer-admin.ts nominate <new_admin_pubkey>");
      process.exit(1);
    }

    const newAdmin = new PublicKey(args[1]);
    const config = await program.account.icoConfig.fetch(icoConfigPda);

    console.log("Nominating new admin...");
    console.log(`  Current admin:  ${config.admin.toBase58()}`);
    console.log(`  New admin:      ${newAdmin.toBase58()}`);

    const tx = await program.methods
      .nominateAdmin(newAdmin)
      .accounts({
        admin: provider.wallet.publicKey,
      })
      .rpc();

    console.log(`\nAdmin nominated! tx: ${tx}`);
    console.log("The new admin must call 'accept' to complete the transfer.");
  } else if (command === "accept") {
    const config = await program.account.icoConfig.fetch(icoConfigPda);
    const pendingAdmin = config.pendingAdmin;

    if (pendingAdmin.equals(PublicKey.default)) {
      console.error("No pending admin nomination.");
      process.exit(1);
    }

    console.log("Accepting admin role...");
    console.log(`  Current admin:  ${config.admin.toBase58()}`);
    console.log(`  Pending admin:  ${pendingAdmin.toBase58()}`);
    console.log(`  Signer:         ${provider.wallet.publicKey.toBase58()}`);

    const tx = await program.methods
      .acceptAdmin()
      .accounts({
        newAdmin: provider.wallet.publicKey,
      })
      .rpc();

    console.log(`\nAdmin transfer complete! tx: ${tx}`);
    console.log(`New admin: ${provider.wallet.publicKey.toBase58()}`);
  } else {
    console.log(`Unknown command: ${command}`);
    console.log("Usage: transfer-admin.ts nominate <pubkey> | accept");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
