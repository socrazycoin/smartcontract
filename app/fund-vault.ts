/**
 * fund-vault.ts — Transfer tokens into the ICO vault.
 *
 * Usage:
 *   npx ts-node app/fund-vault.ts <amount_raw>
 *
 * Example (fund 544,444,444 tokens, 6 decimals):
 *   npx ts-node app/fund-vault.ts 544444444000000
 *
 * The admin must have tokens in their ATA to fund the vault.
 */
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
  transfer,
} from "@solana/spl-token";
import BN from "bn.js";
import {
  createProvider,
  getProgram,
  loadKeypair,
  deriveIcoConfig,
} from "./helpers";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log("Usage: fund-vault.ts <amount_raw>");
    process.exit(1);
  }

  const amount = BigInt(args[0]);

  const adminKp = loadKeypair();
  const provider = createProvider(adminKp);
  const program = getProgram(provider);
  const [icoConfigPda] = deriveIcoConfig(program.programId);
  const config = await program.account.icoConfig.fetch(icoConfigPda);
  const tokenMint = config.tokenMint;

  const adminAta = await getAssociatedTokenAddress(
    tokenMint,
    adminKp.publicKey
  );
  const vaultAta = await getAssociatedTokenAddress(
    tokenMint,
    icoConfigPda,
    true
  );

  const adminBefore = await getAccount(provider.connection, adminAta);
  console.log(`Funding vault with ${amount.toString()} tokens...`);
  console.log(`  Admin ATA balance: ${adminBefore.amount.toString()}`);

  const tx = await transfer(
    provider.connection,
    adminKp,
    adminAta,
    vaultAta,
    adminKp.publicKey,
    amount
  );

  const vaultAfter = await getAccount(provider.connection, vaultAta);
  console.log(`\nVault funded! tx: ${tx}`);
  console.log(`  Vault balance: ${vaultAfter.amount.toString()}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
