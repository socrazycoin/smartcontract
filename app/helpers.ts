import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { Contract } from "../target/types/contract";

dotenv.config();

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

export function loadKeypair(keypairPath?: string): Keypair {
  const resolved = keypairPath || process.env.ADMIN_KEYPAIR || "~/.config/solana/id.json";
  const expandedPath = resolved.replace("~", process.env.HOME || "");
  const raw = JSON.parse(fs.readFileSync(expandedPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function getClusterUrl(): string {
  return process.env.CLUSTER_URL || "http://localhost:8899";
}

export function getProgramId(): PublicKey {
  if (process.env.PROGRAM_ID) {
    return new PublicKey(process.env.PROGRAM_ID);
  }
  // Fallback: read from target/deploy keypair
  const kpPath = path.resolve(__dirname, "../target/deploy/contract-keypair.json");
  const raw = JSON.parse(fs.readFileSync(kpPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw)).publicKey;
}

export function getTokenMint(): PublicKey {
  if (!process.env.TOKEN_MINT) throw new Error("TOKEN_MINT not set in .env");
  return new PublicKey(process.env.TOKEN_MINT);
}

// ---------------------------------------------------------------------------
// Provider & Program
// ---------------------------------------------------------------------------

export function createProvider(keypair?: Keypair): AnchorProvider {
  const kp = keypair || loadKeypair();
  const connection = new Connection(getClusterUrl(), "confirmed");
  const wallet = new Wallet(kp);
  return new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

export function getProgram(provider?: AnchorProvider): Program<Contract> {
  const prov = provider || createProvider();
  const idl = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../target/idl/contract.json"),
      "utf-8"
    )
  );
  return new Program<Contract>(idl, prov);
}

// ---------------------------------------------------------------------------
// PDA derivation
// ---------------------------------------------------------------------------

export function deriveIcoConfig(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ico-config")],
    programId
  );
}

export function deriveStage(programId: PublicKey, stageId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stage"), Buffer.from([stageId])],
    programId
  );
}

export function deriveWhitelistToken(programId: PublicKey, mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist-token"), mint.toBuffer()],
    programId
  );
}

export function deriveUserStagePurchase(
  programId: PublicKey,
  user: PublicKey,
  stageId: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user-stage"), user.toBuffer(), Buffer.from([stageId])],
    programId
  );
}
