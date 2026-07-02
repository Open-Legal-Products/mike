/**
 * DMS secret handling reuses the EXACT AES-256-GCM + per-row HKDF (`v2.`-packed)
 * scheme the MCP connectors use (lib/mcp/client.ts). We deliberately do not
 * reinvent crypto: the same master secret, the same per-row salt derivation,
 * and the same fail-closed decrypt path back every encrypted DMS auth config
 * and OAuth token column.
 *
 * The master secret resolves in this order (see mcp/client.ts::encryptionSecret):
 *   MCP_CONNECTORS_ENCRYPTION_SECRET → USER_API_KEYS_ENCRYPTION_SECRET
 * DMS_CONNECTORS_ENCRYPTION_SECRET is accepted as an alias by copying it onto
 * MCP_CONNECTORS_ENCRYPTION_SECRET at startup (see lib/env.ts) so operators can
 * name the variable after the feature without a second crypto implementation.
 */
export {
    encryptString,
    decryptString,
} from "../mcp/client";
