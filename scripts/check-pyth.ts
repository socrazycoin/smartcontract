import { Connection, PublicKey } from "@solana/web3.js";

const conn = new Connection("https://api.devnet.solana.com");
const priceFeed = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");

async function main() {
  const info = await conn.getAccountInfo(priceFeed);
  if (!info) {
    console.log("Account NOT FOUND on devnet");
    return;
  }
  console.log("Owner:", info.owner.toBase58());
  console.log("Data length:", info.data.length);

  // Dump raw bytes around the data to find the publish_time
  console.log("Raw hex (first 134 bytes):");
  for (let i = 0; i < info.data.length; i += 16) {
    const slice = info.data.subarray(i, Math.min(i + 16, info.data.length));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`  ${i.toString().padStart(3)}: ${hex}`);
  }

  // PriceUpdateV2 layout:
  // 8 (discriminator) + 32 (write_authority) + 1 (verification_level enum) 
  // + PriceFeedMessage: 32 (feed_id) + 8 (price) + 8 (conf) + 4 (exponent) + 8 (publish_time)
  // = 8 + 32 + 1 + 32 + 8 + 8 + 4 = 93 byte offset for publish_time
  for (const offset of [84, 88, 89, 93, 96, 97]) {
    try {
      const ts = Number(info.data.readBigInt64LE(offset));
      const now = Math.floor(Date.now() / 1000);
      if (ts > 1600000000 && ts < 2000000000) {
        console.log(`\nFound publish_time at offset ${offset}: ${ts}`);
        console.log(`  = ${new Date(ts * 1000).toISOString()}`);
        console.log(`  Age: ${now - ts} seconds`);
      }
    } catch {}
  }
}

main().catch(console.error);
