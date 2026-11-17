import { generateSigningKeys, loadIssuer, loadVerifier } from "../src/index.js";

process.env.WILLSPOT_FAST_HASH = "1";

export async function testKeys() {
  const k = await generateSigningKeys();
  return { issuer: await loadIssuer(k.privatePem), verifier: await loadVerifier(k.publicPem), ...k };
}
