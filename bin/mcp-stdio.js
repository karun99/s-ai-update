#!/usr/bin/env node
import { startStdioMcp } from '../dist/src/mcp/server.js';
startStdioMcp().catch(err => { console.error('MCP server error:', err); process.exit(1); });
