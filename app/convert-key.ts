/**
 * emergency-withdraw.ts — Admin emergency withdrawal of tokens from vault.
 *
 * Usage:
 *   npx ts-node app/emergency-withdraw.ts <amount_raw>
 *
 * Example (withdraw 1000 tokens with 6 decimals):
 *   npx ts-node app/emergency-withdraw.ts 1000000000
 */
import BN from "bn.js";
import { createProvider, getProgram, deriveIcoConfig } from "./helpers";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

async function main() {
  // const adminKey = [];
  // console.log("Loading admin keypair from:", adminKey);
  // const wallet = Keypair.fromSecretKey(new Uint8Array(adminKey));

  // console.log("Using wallet:", wallet.publicKey.toBase58());
  // console.log("Using wallet:", bs58.encode(wallet.secretKey));
  // const balance = await createProvider().connection.getBalance(
  //   wallet.publicKey,
  // );
  // console.log("Wallet balance:", balance / 1e9, "SOL");

  // const accountPrivateKey = '';
  // const wallet = Keypair.fromSecretKey(bs58.decode(accountPrivateKey));
  // console.log("Using wallet:", wallet.publicKey.toBase58());
  // console.log("Using wallet:", wallet.secretKey);
  // const balance = await createProvider().connection.getBalance(
  //   wallet.publicKey,
  // );
  // console.log("Wallet balance:", balance / 1e9, "SOL");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
