import { Connection, PublicKey } from "@solana/web3.js";
import { createProvider, getProgram, deriveStage } from "../app/helpers";

async function main() {
  const provider = createProvider();
  const program = getProgram(provider);
  const [pda] = deriveStage(program.programId, 1);
  const info = await provider.connection.getAccountInfo(pda);
  if (!info) { console.log("Not found"); return; }

  console.log("Data length:", info.data.length);
  console.log("First 8 bytes (discriminator):", Array.from(info.data.subarray(0, 8)));

  // IDL discriminator for Stage
  const idl = require("../target/idl/contract.json");
  const stageAccount = idl.accounts.find((a: any) => a.name === "Stage");
  console.log("IDL discriminator:", stageAccount?.discriminator);

  // Match?
  const onChain = Array.from(info.data.subarray(0, 8));
  const expected = stageAccount?.discriminator || [];
  const match = onChain.every((v: number, i: number) => v === expected[i]);
  console.log("Discriminator match:", match);
}

main().catch(console.error);
