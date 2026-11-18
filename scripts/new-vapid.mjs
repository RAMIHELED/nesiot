// Generates a fresh VAPID key pair and installs it with no copy-paste:
//   1. sets VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT as Supabase secrets
//   2. updates VITE_VAPID_PUBLIC_KEY in web/.env
//   3. prints the public key for Vercel
// Run from the project root:  node scripts/new-vapid.mjs your@email.com
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const email = process.argv[2];
if (!email || !email.includes("@")) {
  console.error("Usage: node scripts/new-vapid.mjs your@email.com");
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });
const b64u = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const publicB64 = b64u(Buffer.concat([
  Buffer.from([4]),
  Buffer.from(pub.x, "base64url"),
  Buffer.from(pub.y, "base64url"),
]));
const privateB64 = priv.d; // JWK "d" is already base64url without padding

const tmp = "vapid.tmp.env";
writeFileSync(tmp, `VAPID_PUBLIC_KEY=${publicB64}\nVAPID_PRIVATE_KEY=${privateB64}\nVAPID_SUBJECT=mailto:${email}\n`);
try {
  execSync(`npx supabase secrets set --env-file ${tmp}`, { stdio: "inherit" });
} finally {
  unlinkSync(tmp); // never leave the private key on disk
}

const envPath = "web/.env";
if (existsSync(envPath)) {
  let env = readFileSync(envPath, "utf8");
  env = /^VITE_VAPID_PUBLIC_KEY=.*$/m.test(env)
    ? env.replace(/^VITE_VAPID_PUBLIC_KEY=.*$/m, `VITE_VAPID_PUBLIC_KEY=${publicB64}`)
    : env.trimEnd() + `\nVITE_VAPID_PUBLIC_KEY=${publicB64}\n`;
  writeFileSync(envPath, env);
  console.log("\nweb/.env updated.");
}

console.log("\nSupabase secrets set. Now paste this PUBLIC key into Vercel (VITE_VAPID_PUBLIC_KEY):\n");
console.log(publicB64 + "\n");
