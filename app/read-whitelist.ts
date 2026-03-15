/**
 * read-whitelist.ts — Fetch and display WhitelistToken accounts.
 *
 * Usage:
 *   npx ts-node app/read-whitelist.ts <payment_mint>
 *   npx ts-node app/read-whitelist.ts all                 # list all known whitelist entries
 *
 * Examples:
 *   npx ts-node app/read-whitelist.ts EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
 *   npx ts-node app/read-whitelist.ts all
 *
 * Common mints:
 *   SOL (wrapped):  So11111111111111111111111111111111111111112
 *   USDC (mainnet): EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
 *   USDT (mainnet): Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB
 */
import { PublicKey } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  createProvider,
  getProgram,
  deriveWhitelistToken,
} from "./helpers";

const WELL_KNOWN_MINTS: { name: string; mint: PublicKey }[] = [
  { name: "SOL (native)", mint: NATIVE_MINT },
  { name: "USDC (mainnet)", mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") },
  { name: "USDT (mainnet)", mint: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB") },
];

function printWhitelist(wl: any, pda: PublicKey, label?: string) {
  const prefix = label ? ` (${label})` : "";
  console.log(`=== WhitelistToken${prefix} ===`);
  console.log(`  PDA:     ${pda.toBase58()}`);
  console.log(`  Mint:    ${wl.mint.toBase58()}`);
  console.log(`  Enabled: ${wl.enabled}`);
  console.log(`  Decimals: ${wl.decimals}`);
  console.log(`  Bump:    ${wl.bump}`);
  console.log();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log("Usage: read-whitelist.ts <payment_mint | all>");
    process.exit(1);
  }

  const provider = createProvider();
  const program = getProgram(provider);

  if (args[0] === "all") {
    console.log("Scanning well-known mints for whitelist entries...\n");

    let found = 0;
    for (const { name, mint } of WELL_KNOWN_MINTS) {
      try {
        const [wlPda] = deriveWhitelistToken(program.programId, mint);
        const wl = await program.account.whitelistToken.fetch(wlPda);
        printWhitelist(wl, wlPda, name);
        found++;
      } catch {
        // not whitelisted
      }
    }

    // Also scan all WhitelistToken accounts via getProgramAccounts
    console.log("Scanning all WhitelistToken accounts on-chain...\n");
    const allAccounts = await program.account.whitelistToken.all();
    for (const { publicKey, account } of allAccounts) {
      const alreadyShown = WELL_KNOWN_MINTS.some((wk) => wk.mint.equals(account.mint));
      if (!alreadyShown) {
        printWhitelist(account, publicKey);
        found++;
      }
    }

    if (found === 0) {
      console.log("No whitelist entries found.");
    }
  } else {
    const mint = new PublicKey(args[0]);
    const [wlPda] = deriveWhitelistToken(program.programId, mint);

    try {
      const wl = await program.account.whitelistToken.fetch(wlPda);
      printWhitelist(wl, wlPda);
    } catch (err: any) {
      console.error(`No whitelist entry found for mint ${mint.toBase58()}.`);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
