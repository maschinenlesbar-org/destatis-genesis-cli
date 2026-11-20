// The credentials file (`destatis config`): the store lives with the client, which the CLI and
// the MCP server share (packages/client/src/credentials.ts); re-exported here for the CLI's code
// and tests.

export * from "@maschinenlesbar.org/destatis-genesis-client/internal/credentials";
