/**
 * emergency-withdraw.ts — Admin emergency withdrawal from the ICO.
 *
 * Usage:
 *   npx ts-node app/emergency-withdraw.ts <amount_raw>              # Withdraw tokens
 *   npx ts-node app/emergency-withdraw.ts <mint_address> <amount>   # Withdraw any SPL token
 *   npx ts-node app/emergency-withdraw.ts --sol <amount_lamports>   # Withdraw SOL from PDA
 *
 * Examples:
 *   npx ts-node app/emergency-withdraw.ts 1000000000
 *   npx ts-node app/emergency-withdraw.ts EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 1000000
 *   npx ts-node app/emergency-withdraw.ts --sol 500000000
 */
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { createProvider, getProgram, deriveIcoConfig } from "./helpers";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log("Usage:");
    console.log("  emergency-withdraw.ts <amount_raw>              # Tokens");
    console.log("  emergency-withdraw.ts <mint_address> <amount>   # Any SPL token");
    console.log("  emergency-withdraw.ts --sol <amount_lamports>   # SOL from PDA");
    process.exit(1);
  }

  const provider = createProvider();
  const program = getProgram(provider);
  const [icoConfigPda] = deriveIcoConfig(program.programId);
  const config = await program.account.icoConfig.fetch(icoConfigPda);

  if (args[0] === "--sol") {
    // Withdraw SOL from ico_config PDA
    const amount = new BN(args[1]);
    console.log(`Emergency withdrawing ${amount.toString()} lamports (SOL) from PDA...`);
    console.log(`  Admin: ${provider.wallet.publicKey.toBase58()}`);

    const tx = await program.methods
      .emergencyWithdrawSol(amount)
      .accounts({
        admin: provider.wallet.publicKey
      })
      .rpc();

    console.log(`\nSOL withdrawal complete! tx: ${tx}`);
  } else {
    // Withdraw SPL tokens
    let tokenMint: PublicKey;
    let amount: BN;

    if (args.length >= 2) {
      // Explicit mint address
      tokenMint = new PublicKey(args[0]);
      amount = new BN(args[1]);
    } else {
      // Default: token mint
      tokenMint = config.tokenMint;
      amount = new BN(args[0]);
    }

    console.log(`Emergency withdrawing ${amount.toString()} tokens...`);
    console.log(`  Admin: ${provider.wallet.publicKey.toBase58()}`);
    console.log(`  Mint:  ${tokenMint.toBase58()}`);

    const tx = await program.methods
      .emergencyWithdraw(amount)
      .accounts({
        tokenMint,
      })
      .rpc();

    console.log(`\nWithdrawal complete! tx: ${tx}`);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
