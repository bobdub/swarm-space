/**
 * `swarm-identity-<username>.md` — a human-readable credential card with YAML
 * frontmatter. It carries only PUBLIC material (handle, public key, cold
 * receiving address, recovery link). Never the private key or any passphrase.
 */

export interface IdentityCredentialInput {
  username: string;
  displayName?: string;
  userId: string;
  discriminator: string | null;
  shellVersion: number;
  genesisDefault: boolean;
  publicKey: string;
  coldAddress: string | null;
  recoveryUrl: string;
  generatedAt?: Date;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function credentialFileName(username: string): string {
  const safe = username.replace(/[^a-zA-Z0-9_-]+/g, "_") || "account";
  return `swarm-identity-${safe}.md`;
}

export function buildIdentityCredentialMarkdown(input: IdentityCredentialInput): string {
  const handle = input.discriminator ? `${input.username}#${input.discriminator}` : input.username;
  const generatedAt = (input.generatedAt ?? new Date()).toISOString();
  const warning =
    `This vault is sealed by Outer Shell Version ${input.shellVersion}. ` +
    `It requires your active Recovery Passphrase to unlock. Your local account password will NOT open this vault.`;
  const genesisNote = input.genesisDefault
    ? "\n> **Genesis shell:** version 1 is still sealed with your signup password. Wrap a separate Recovery Passphrase in Settings → Security; from then on only that passphrase opens the vault.\n"
    : "";

  return [
    "---",
    `username: ${yamlString(input.username)}`,
    ...(input.displayName ? [`display_name: ${yamlString(input.displayName)}`] : []),
    `handle: ${yamlString(handle)}`,
    `discriminator: ${input.discriminator ? yamlString(input.discriminator) : "null"}`,
    `user_id: ${yamlString(input.userId)}`,
    `shell_version: ${input.shellVersion}`,
    `public_key: ${yamlString(input.publicKey)}`,
    `cold_wallet_address: ${input.coldAddress ? yamlString(input.coldAddress) : "null"}`,
    `recovery_url: ${yamlString(input.recoveryUrl)}`,
    `generated_at: ${yamlString(generatedAt)}`,
    "---",
    "",
    `# Swarm Space identity: ${handle}`,
    "",
    `> **Security warning:** ${warning}`,
    genesisNote,
    "## Recover on a new device",
    "",
    `1. Open your Recovery Link: <${input.recoveryUrl}>`,
    "2. The page reaches a peer holding your encrypted vault (version " + input.shellVersion + " or newer).",
    "3. Enter your active Recovery Passphrase, then choose a new local password for that device.",
    "",
    "## What peers hold",
    "",
    "Peers keep only an AES-256-GCM encrypted container (PBKDF2-SHA-256, 250,000 iterations),",
    "signed by your identity key. They cannot read or decrypt your private key.",
    "",
    "## Public identity",
    "",
    `- **Handle:** ${handle}`,
    `- **User ID:** \`${input.userId}\``,
    `- **Cold wallet (receiving):** ${input.coldAddress ? `\`${input.coldAddress}\`` : "not yet derived"}`,
    `- **Public key:** \`${input.publicKey}\``,
    "",
    "This file contains no secrets. Keep your Recovery Passphrase somewhere else.",
    "",
  ].join("\n");
}
