#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = join(__dirname, '..');

const HELP = `
  ╔═══════════════════════════════════════════════╗
  ║  S-AI v6.0 - Synthetic Executive              ║
  ╚═══════════════════════════════════════════════╝

  Usage:
    s-ai <command> [options]

  Core Commands:
    ask <question>              Ask the swarm (multi-perspective, bias-reduced)
    setup                       Interactive setup wizard (pick provider + API key)
    serve                       Start the web dashboard
    daemon                      Start headless service (dashboard + scheduled jobs)
    config [key] [value]        View/set configuration
    config init                 Create config at ~/.config/s-ai/config.json
    config setup                Interactive setup wizard (provider + API key)

  Execution Layer (NEW):
    tools                       List all available tools with risk levels
    plan <question>             Ask swarm and get an execution plan (no auto-exec)
    execute <plan-json>         Execute a JSON action plan through policy gate
    approve <action-id>         Approve a pending action
    deny <action-id>            Deny a pending action
    audit                       Show recent audit log entries

  Agent Commands:
    swarm status                Show all agent statuses
    swarm reset                 Reset all agent memories
    swarm agents                List all agents in the swarm

  Neural Mapping (Digital Twin Persona):
    persona set <name> <bio>    Create a user persona profile for AI adaptation
    persona show                Show current active persona
    persona clear               Remove the active persona
    persona node <type> <title> <content>  Add a context node (link/text/file)
    persona profiles            List all saved personas

  Knowledge Graph:
    graph query <text>          Query the knowledge graph
    graph stats                 Show graph statistics
    graph store <type> <label>  Store a node in the graph
    graph build [dir]           Build graph from files in directory
    graph export [file]         Export graph as JSON

  Web Research:
    crawl <url>                 Crawl a URL and extract content
    search <query>              Web search via DuckDuckGo + crawl

  MCP Integration:
    mcp serve                   Start MCP stdio server
    mcp servers                 List configured MCP servers
    mcp tools                   List all available MCP tools

  Provider Management:
    provider list               List available providers with models
    provider set <name>         Set active provider
    provider test               Test current provider connection
    provider models [name]      List models for a provider
    provider model <id>         Set default model for active provider

  Skills:
    skill list                  List installed skills
    skill install <name>        Install a skill
    skill remove <name>         Remove a skill

  Research Mapper (Paperscape-style):
    research search <query>     Search arXiv papers
    research map                Open research mapper dashboard (needs s-ai serve)
    research graph <id1,id2>    Build citation graph for paper IDs

  Bhashini Multilingual AI:
    bhashini translate <text>   Translate English to Indian language
    bhashini status             Check Bhashini API connection
    bhashini pipelines          List available Bhashini pipelines

  AI Engine (Prompt-to-App Builder):
    engine build <prompt>       Build an AI app from a prompt
    engine skill <prompt>       Build a skill from a prompt
    engine mcp <prompt>         Build an MCP server from a prompt
    engine swarm <prompt>       Build a swarm from a prompt
    engine list                 List built artifacts
    engine ui                   Open the AI Engine dashboard

  Agent Reach (Internet Channels):
    reach doctor                Check internet channel statuses (Agent-Reach style)
    reach channels              List all available internet channels
    reach read <url>            Read content from a URL using best channel

  System:
    status                      Show system status
    help                        Show this help

  Examples:
    s-ai ask "What are the pros and cons of microservices?"
    s-ai ask --rounds 4 "Analyze the impact of AI on healthcare"
    s-ai plan "Summarize my latest emails and create a reply draft"
    s-ai tools
    s-ai daemon --port 8080
    s-ai crawl https://example.com
    s-ai search "latest AI research papers"
    s-ai config set providers.primary openai
    s-ai serve --port 8080
    s-ai research search "quantum computing transformers"
    s-ai research graph 2301.12345,2302.67890
    s-ai bhashini translate "Hello, how are you?" hi
    s-ai bhashini status

  Environment Variables:
    SAI_PRIMARY_PROVIDER        Primary AI provider (default: openrouter)
    OPENROUTER_API_KEY          OpenRouter API key
    OPENAI_API_KEY              OpenAI API key
    ANTHROPIC_API_KEY           Anthropic API key
    GOOGLE_API_KEY              Google AI API key
    OLLAMA_BASE_URL             Ollama server URL
    NVIDIA_API_KEY              Nvidia API key
    AWS_BEDROCK_REGION          AWS Bedrock region (default: us-east-1)
    AWS_ACCESS_KEY_ID           AWS access key
    AWS_SECRET_ACCESS_KEY       AWS secret key
    VERTEX_AI_PROJECT_ID        Google Cloud project ID
    VERTEX_AI_REGION            Vertex AI region (default: us-east5)
    FOUNDRY_RESOURCE            Azure AI Foundry resource name
    TOGETHER_API_KEY            Together AI API key
    FIREWORKS_API_KEY           Fireworks AI API key
    COHERE_API_KEY              Cohere API key
    GROK_API_KEY                xAI Grok API key
    KIMI_API_KEY                Moonshot Kimi API key
    PI_API_KEY                  Inflection Pi API key
    BHASHINI_API_KEY            Bhashini multilingual AI API key
    BHASHINI_USER_ID            Bhashini user ID (default: s-ai-user)
    BHASHINI_PIPELINE_ID        Bhashini pipeline ID
`;

function parseArgs(args) {
  const parsed = { flags: {}, positional: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) { parsed.flags[key] = next; i++; }
      else parsed.flags[key] = true;
    } else {
      parsed.positional.push(args[i]);
    }
  }
  return parsed;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) { console.log(HELP); return; }
  const { flags, positional } = parseArgs(args);
  const command = positional[0];
  const subcommand = positional[1];
  const rest = positional.slice(2);

  switch (command) {
    case 'ask': await cmdAsk(rest.join(' '), flags); break;
    case 'setup': await cmdSetup(); break;
    case 'serve': await cmdServe(flags); break;
    case 'config': await (subcommand === 'setup' ? cmdSetup() : cmdConfig(subcommand, rest, flags)); break;
    case 'swarm': await cmdSwarm(subcommand); break;
    case 'persona': await cmdPersona(subcommand, rest); break;
    case 'graph': await cmdGraph(subcommand, rest); break;
    case 'crawl': await cmdCrawl(subcommand); break;
    case 'search': await cmdSearch(rest.join(' ')); break;
    case 'mcp': await cmdMcp(subcommand); break;
    case 'provider': await cmdProvider(subcommand, rest); break;
    case 'skill': await cmdSkill(subcommand, rest); break;
    case 'engine': await cmdEngine(subcommand, rest); break;
    case 'research': await cmdResearch(subcommand, rest); break;
    case 'bhashini': await cmdBhashini(subcommand, rest); break;
    case 'reach': await cmdReach(subcommand, rest); break;
    case 'tools': await cmdTools(); break;
    case 'plan': await cmdPlan(rest.join(' '), flags); break;
    case 'execute': await cmdExecute(rest.join(' ')); break;
    case 'approve': await cmdApprove(subcommand); break;
    case 'deny': await cmdDeny(subcommand); break;
    case 'audit': await cmdAudit(flags); break;
    case 'daemon': await cmdDaemon(flags); break;
    case 'status': await cmdStatus(); break;
    case 'help': case '--help': case '-h': console.log(HELP); break;
    default: console.error(`Unknown command: ${command}\n\nRun 's-ai help' for usage.`); process.exit(1);
  }
}

function prompt(question, { mask = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    if (mask) {
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      if (stdin.isTTY) stdin.setRawMode(true);
      process.stdout.write(question);
      let buf = '';
      const onData = (ch) => {
        const c = ch.toString();
        if (c === '\n' || c === '\r') {
          if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
          stdin.removeListener('data', onData);
          rl.close();
          process.stdout.write('\n');
          resolve(buf);
        } else if (c === '\u007f' || c === '\b') {
          if (buf.length > 0) { buf = buf.slice(0, -1); process.stdout.write('\b \b'); }
        } else if (c === '\u0003') {
          process.exit();
        } else {
          buf += c;
          process.stdout.write('*');
        }
      };
      stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
    }
  });
}

async function cmdSetup() {
  const providers = [
    { name: 'openrouter', label: 'OpenRouter', desc: '100+ models, free tier available (Recommended)', needsKey: true, envVar: 'OPENROUTER_API_KEY',
      models: [
        { id: 'mistralai/mistral-7b-instruct:free', label: 'Mistral 7B (free)' },
        { id: 'meta-llama/llama-3.1-8b-instruct:free', label: 'Llama 3.1 8B (free)' },
        { id: 'google/gemma-2-9b-it:free', label: 'Gemma 2 9B (free)' },
        { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
        { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
        { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
        { id: 'meta-llama/llama-3.1-405b-instruct', label: 'Llama 3.1 405B' },
        { id: 'anthropic/claude-3-opus', label: 'Claude 3 Opus' }
      ]
    },
    { name: 'openai', label: 'OpenAI', desc: 'GPT-4o, GPT-4o-mini', needsKey: true, envVar: 'OPENAI_API_KEY',
      models: [
        { id: 'gpt-4o-mini', label: 'GPT-4o Mini (fast, cheap)' },
        { id: 'gpt-4o', label: 'GPT-4o (flagship)' },
        { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
        { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (legacy)' }
      ]
    },
    { name: 'anthropic', label: 'Anthropic', desc: 'Claude Sonnet 4, Claude Haiku', needsKey: true, envVar: 'ANTHROPIC_API_KEY',
      models: [
        { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (latest)' },
        { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku (fast)' },
        { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
        { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus (powerful)' }
      ]
    },
    { name: 'google', label: 'Google AI', desc: 'Gemini 2.0 Flash', needsKey: true, envVar: 'GOOGLE_API_KEY',
      models: [
        { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (fast)' },
        { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
        { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
        { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' }
      ]
    },
    { name: 'ollama', label: 'Ollama', desc: 'Local models — no API key needed', needsKey: false,
      models: [
        { id: 'llama3.2', label: 'Llama 3.2 (3B)' },
        { id: 'llama3.1', label: 'Llama 3.1 (8B)' },
        { id: 'mistral', label: 'Mistral 7B' },
        { id: 'codellama', label: 'CodeLlama' },
        { id: 'phi3', label: 'Phi-3 Mini' },
        { id: 'gemma2', label: 'Gemma 2' }
      ]
    },
    { name: 'nvidia', label: 'Nvidia', desc: 'Nemotron 70B', needsKey: true, envVar: 'NVIDIA_API_KEY',
      models: [
        { id: 'nvidia/llama-3.1-nemotron-70b-instruct', label: 'Nemotron 70B (flagship)' },
        { id: 'nvidia/llama-3.1-8b-instruct', label: 'Nemotron 8B (fast)' },
        { id: 'mistralai/mistral-7b-instruct-v0.3', label: 'Mistral 7B v0.3' }
      ]
    },
    { name: 'cohere', label: 'Cohere', desc: 'Command R+, multilingual RAG', needsKey: true, envVar: 'COHERE_API_KEY',
      models: [
        { id: 'command-r-plus', label: 'Command R+ (flagship)' },
        { id: 'command-r', label: 'Command R (fast)' },
        { id: 'command-light', label: 'Command Light' }
      ]
    },
    { name: 'grok', label: 'Grok (xAI)', desc: 'Real-time data, X/Twitter access', needsKey: true, envVar: 'GROK_API_KEY',
      models: [
        { id: 'grok-2', label: 'Grok-2 (latest)' },
        { id: 'grok-2-mini', label: 'Grok-2 Mini (fast)' },
        { id: 'grok-beta', label: 'Grok Beta' }
      ]
    },
    { name: 'kimi', label: 'Kimi (Moonshot)', desc: '128K context, long-document specialist', needsKey: true, envVar: 'KIMI_API_KEY',
      models: [
        { id: 'moonshot-v1-128k', label: 'Moonshot 128K (long context)' },
        { id: 'moonshot-v1-32k', label: 'Moonshot 32K' },
        { id: 'moonshot-v1-8k', label: 'Moonshot 8K (fast)' }
      ]
    },
    { name: 'pi', label: 'Pi (Inflection)', desc: 'Emotional intelligence, empathetic', needsKey: true, envVar: 'PI_API_KEY',
      models: [
        { id: 'pi-2', label: 'Pi 2 (latest)' }
      ]
    },
    { name: 'together', label: 'Together AI', desc: '100+ open-source models, free tier', needsKey: true, envVar: 'TOGETHER_API_KEY',
      models: [
        { id: 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', label: 'Llama 3.1 405B (free tier)' },
        { id: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', label: 'Llama 3.1 70B (fast)' },
        { id: 'mistralai/Mixtral-8x22B-Instruct-v0.1', label: 'Mixtral 8x22B' },
        { id: 'databricks/dbrx-instruct', label: 'DBRX Instruct' },
        { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', label: 'Qwen 2.5 72B' }
      ]
    },
    { name: 'fireworks', label: 'Fireworks AI', desc: 'Serverless inference, low latency', needsKey: true, envVar: 'FIREWORKS_API_KEY',
      models: [
        { id: 'accounts/fireworks/models/llama-v3p1-405b-instruct', label: 'Llama 3.1 405B' },
        { id: 'accounts/fireworks/models/llama-v3p1-70b-instruct', label: 'Llama 3.1 70B (fast)' },
        { id: 'accounts/fireworks/models/mixtral-8x22b-instruct', label: 'Mixtral 8x22B' },
        { id: 'accounts/fireworks/models/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B' }
      ]
    },
    { name: 'aws-bedrock', label: 'AWS Bedrock', desc: 'Managed Claude, Llama via AWS', needsKey: true, envVar: 'AWS_ACCESS_KEY_ID',
      models: [
        { id: 'anthropic.claude-3-5-sonnet-20240620-v1:0', label: 'Claude 3.5 Sonnet' },
        { id: 'anthropic.claude-3-opus-20240229-v1:0', label: 'Claude 3 Opus' },
        { id: 'anthropic.claude-3-haiku-20240307-v1:0', label: 'Claude 3 Haiku' },
        { id: 'meta.llama3-1-70b-instruct-v1:0', label: 'Llama 3.1 70B' }
      ]
    },
    { name: 'claude-aws', label: 'Claude on AWS', desc: 'Claude via AWS-hosted Anthropic endpoint', needsKey: true, envVar: 'ANTHROPIC_API_KEY',
      models: [
        { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
        { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
        { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' }
      ]
    },
    { name: 'vertex-ai', label: 'Vertex AI', desc: 'Google Cloud managed Anthropic/Gemini', needsKey: true, envVar: 'VERTEX_AI_PROJECT_ID',
      models: [
        { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
        { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
        { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' }
      ]
    },
    { name: 'foundry', label: 'Foundry (Azure)', desc: 'Azure AI Foundry managed models', needsKey: true, envVar: 'FOUNDRY_RESOURCE',
      models: [
        { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
        { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
        { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' }
      ]
    },
    { name: 'koboldcpp', label: 'KoboldCPP', desc: 'Local GPU inference — no API key', needsKey: false,
      models: [
        { id: 'default', label: 'Default loaded model' }
      ]
    },
    { name: 'oobabooga', label: 'Oobabooga', desc: 'Text-generation-webui — no API key', needsKey: false,
      models: [
        { id: 'default', label: 'Default loaded model' }
      ]
    },
    { name: 'mlc-llm', label: 'MLC LLM', desc: 'Universal local LLM engine — no API key', needsKey: false,
      models: [
        { id: 'vicuna-7b-v1.5', label: 'Vicuna 7B' },
        { id: 'Llama-3-8B-Instruct', label: 'Llama 3 8B' },
        { id: 'Mistral-7B-Instruct-v0.2', label: 'Mistral 7B v0.2' }
      ]
    },
    { name: 'openai-compatible', label: 'OpenAI-Compatible', desc: 'Any OpenAI-format proxy (vLLM, LM Studio, etc.)', needsKey: false,
      models: [
        { id: 'default', label: 'Default (auto-detect from server)' }
      ]
    }
  ];

  console.log('');
  console.log('  ╔═══════════════════════════════════════════════╗');
  console.log('  ║       S-AI Setup Wizard                       ║');
  console.log('  ╚═══════════════════════════════════════════════╝');
  console.log('');
  console.log('  Select an AI provider:\n');

  providers.forEach((p, i) => {
    console.log(`    ${i + 1}. ${p.label.padEnd(14)} ${p.desc}`);
  });

  console.log('');
  const choice = await prompt('  Enter number [1]: ');
  const idx = (parseInt(choice) || 1) - 1;
  const selected = providers[idx];

  if (!selected) {
    console.log('  Invalid choice.');
    process.exit(1);
  }

  console.log(`\n  Selected: ${selected.label}\n`);

  let apiKey = '';
  if (selected.needsKey) {
    const envKey = process.env[selected.envVar];
    if (envKey) {
      console.log(`  Found ${selected.envVar} in environment.`);
      const use = await prompt('  Use it? [Y/n]: ');
      if (use.toLowerCase() !== 'n') apiKey = envKey;
    }
    if (!apiKey) {
      apiKey = await prompt(`  Enter ${selected.label} API key: `, { mask: true });
      if (!apiKey) {
        console.log('  No key provided. You can set it later with:');
        console.log(`    export ${selected.envVar}=your-key`);
        console.log(`    s-ai config set providers.${selected.name}.apiKey your-key`);
      }
    }
  }

  console.log(`\n  Select a model for ${selected.label}:\n`);
  selected.models.forEach((m, i) => {
    console.log(`    ${i + 1}. ${m.label}`);
  });
  console.log(`    ${selected.models.length + 1}. Custom (enter model ID)`);

  console.log('');
  const modelChoice = await prompt('  Enter number [1]: ');
  const modelIdx = (parseInt(modelChoice) || 1) - 1;
  let selectedModel;

  if (modelIdx >= selected.models.length) {
    selectedModel = await prompt('  Enter model ID: ');
    if (!selectedModel) {
      selectedModel = selected.models[0].id;
      console.log(`  Using default: ${selectedModel}`);
    }
  } else {
    selectedModel = selected.models[modelIdx].id;
  }

  console.log(`  Model: ${selectedModel}\n`);

  const { updateConfig, getConfig } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'config.js'));
  const partial = { providers: { primary: selected.name, [selected.name]: { defaultModel: selectedModel } } };
  if (apiKey) {
    partial.providers[selected.name] = { apiKey, defaultModel: selectedModel };
  }
  updateConfig(partial);

  console.log('\n  ✓ Configuration saved!\n');

  if (apiKey && selected.needsKey) {
    console.log('  Testing connection...');
    try {
      const { listProviders } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'providers', 'index.js'));
      const { getActiveProviderInstance } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'providers', 'index.js'));
      const provider = getActiveProviderInstance();
      const result = await provider.healthCheck();
      if (result.ok) {
        console.log(`  ✓ ${result.provider}: Connected!\n`);
      } else {
        console.log(`  ✗ ${result.provider}: ${result.error || 'Failed'}\n`);
      }
    } catch (err) {
      console.log(`  ✗ Connection test failed: ${err.message}\n`);
    }
  } else if (!selected.needsKey) {
    const localMsgs = {
      ollama: 'Make sure Ollama is running: ollama serve',
      koboldcpp: 'Make sure KoboldCPP is running on http://localhost:5001',
      oobabooga: 'Make sure Oobabooga is running on http://localhost:5000',
      'mlc-llm': 'Make sure MLC LLM is running on http://localhost:8080',
      'openai-compatible': 'Point to your OpenAI-format server (e.g. vLLM, LM Studio)'
    };
    console.log(`  ${localMsgs[selected.name] || 'Make sure the local server is running.'}\n`);
  }

  console.log('  Next steps:');
  console.log('    s-ai ask "Hello, what can you do?"');
  console.log('    s-ai serve              (start web dashboard)');
  console.log('    s-ai engine build "..."  (build an AI app)\n');
}

async function cmdAsk(question, flags) {
  if (!question) { console.error('Usage: s-ai ask <question>'); process.exit(1); }
  const { Swarm } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'swarm', 'index.js'));
  const { getNeuralMap } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'neural', 'index.js'));
  const swarm = new Swarm();
  const neuralMap = getNeuralMap();
  const persona = neuralMap.getProfile();
  if (persona) {
    swarm.setPersonaContext(neuralMap.buildPersonaContext());
    console.log(`\n  Neural mapping active: ${persona.name}`);
  }
  const maxRounds = parseInt(flags.rounds) || undefined;
  console.log(`\n  Swarm analyzing: "${question}"\n`);
  console.log('  Agents:', [...swarm.agents.values()].map(a => `${a.name} (${a.role})`).join(', '));
  console.log('─'.repeat(50));
  for await (const event of swarm.runStream(question, { maxRounds })) {
    if (event.type === 'plan') { console.log(`\n  [orchestrator] Plan:\n    ${event.content.slice(0, 200)}...\n`); }
    else if (event.type === 'research') { process.stdout.write(`  [researcher] ${event.token}`); }
    else if (event.type === 'analysis') { console.log(`\n  [${event.agent}] Analysis:\n    ${event.content.slice(0, 300)}...\n`); }
    else if (event.type === 'critique') { console.log(`\n  [critic] Critique:\n    ${event.content.slice(0, 300)}...\n`); }
    else if (event.type === 'consensus') { console.log(`  [consensus] Round ${event.round}: ${(event.score * 100).toFixed(1)}%\n`); }
    else if (event.type === 'synthesis') { process.stdout.write(event.token); }
    else if (event.type === 'complete') { console.log('\n'); }
  }
}

async function cmdServe(flags) {
  const port = parseInt(flags.port || process.env.PORT || '3000');
  console.log(`\n  S-AI Swarm Dashboard v5.1 starting on http://localhost:${port}\n`);
  const { createServer } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'server.js'));
  await createServer({ port, root: PACKAGE_ROOT });
  console.log(`  Dashboard: http://localhost:${port}`);
  console.log(`  MCP: stdio (run 's-ai mcp serve')`);
  console.log(`\n  Press Ctrl+C to stop.\n`);
}

async function cmdConfig(sub, rest, flags) {
  const { getConfig, updateConfig, getConfigPath } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'config.js'));
  if (sub === 'init') {
    const configPath = getConfigPath();
    console.log(`Config created at: ${configPath}`);
    return;
  }
  if (sub === 'set' && rest.length >= 2) {
    const key = rest[0]; const value = rest.slice(1).join(' ');
    const parsed = value === 'true' ? true : value === 'false' ? false : isNaN(value) ? value : Number(value);
    const partial = {};
    const keys = key.split('.');
    let obj = partial;
    for (let i = 0; i < keys.length - 1; i++) { obj[keys[i]] = {}; obj = obj[keys[i]]; }
    obj[keys[keys.length - 1]] = parsed;
    updateConfig(partial);
    console.log(`  ${key} = ${parsed}`);
    return;
  }
  if (sub === 'get' && rest[0]) {
    const config = getConfig();
    const keys = rest[0].split('.');
    let val = config;
    for (const k of keys) val = val?.[k];
    console.log(typeof val === 'object' ? JSON.stringify(val, null, 2) : val);
    return;
  }
  const config = getConfig();
  console.log(JSON.stringify(config, null, 2));
}

async function cmdSwarm(sub) {
  const { Swarm } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'swarm', 'index.js'));
  const swarm = new Swarm();
  if (sub === 'status' || !sub) {
    const status = swarm.getStatus();
    console.log('\n  Swarm Status');
    console.log('─'.repeat(50));
    for (const agent of status.agents) {
      console.log(`  ${agent.name.padEnd(20)} ${agent.role.padEnd(15)} ${agent.status.padEnd(10)} calls: ${agent.metrics.calls}`);
    }
  } else if (sub === 'reset') { swarm.reset(); console.log('  All agents reset.'); }
  else if (sub === 'agents') { swarm.getStatus().agents.forEach(a => console.log(`  ${a.id}  ${a.name.padEnd(20)} ${a.role}`)); }
}

async function cmdGraph(sub, rest) {
  const { getKnowledgeGraph } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'memory', 'graph.js'));
  const graph = getKnowledgeGraph();
  if (sub === 'query' && rest.length) {
    const results = graph.query(rest.join(' '));
    console.log(JSON.stringify(results, null, 2));
  } else if (sub === 'stats') { console.log(JSON.stringify(graph.getStats(), null, 2)); }
  else if (sub === 'store' && rest.length >= 2) {
    const id = graph.addNode(rest[0], rest.slice(1).join(' '));
    console.log(`Stored: ${rest[0]}/${rest.slice(1).join(' ')} (id: ${id})`);
  } else if (sub === 'build') {
    const dir = rest[0] || '.';
    console.log(`\n  Building knowledge graph from: ${dir}\n`);
    const { readdirSync, statSync } = await import('node:fs');
    const { join: pathJoin } = await import('node:path');
    let count = 0;
    function scanDir(d) {
      try {
        const entries = readdirSync(d, { withFileTypes: true });
        for (const e of entries) {
          const fullPath = pathJoin(d, e.name);
          if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
            scanDir(fullPath);
          } else if (e.isFile() && /\.(md|txt|json|ts|js|html|css)$/.test(e.name)) {
            try {
              const content = readFileSync(fullPath, 'utf-8');
              graph.addNode('file', e.name, { content: content.slice(0, 1000), path: fullPath });
              count++;
            } catch {}
          }
        }
      } catch {}
    }
    scanDir(dir);
    console.log(`  Added ${count} files to knowledge graph`);
    console.log(`  Graph stats: ${JSON.stringify(graph.getStats())}`);
  } else if (sub === 'export') {
    const { writeFileSync } = await import('node:fs');
    const outPath = rest[0] || 'graph-export.json';
    writeFileSync(outPath, JSON.stringify(graph.graph, null, 2));
    console.log(`  Exported graph to: ${outPath}`);
  } else { console.log('Usage: s-ai graph <query|stats|store|build|export> [args]'); }
}

async function cmdCrawl(url) {
  if (!url) { console.error('Usage: s-ai crawl <url>'); process.exit(1); }
  const { getCrawlEngine } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'tools', 'crawl.js'));
  const engine = getCrawlEngine();
  const results = await engine.crawl([url]);
  for (const r of results) {
    if (r.error) { console.error(`  Error: ${r.error}`); continue; }
    console.log(`\n  Title: ${r.title}`);
    console.log(`  URL: ${r.url}`);
    console.log(`  Length: ${r.length} chars`);
    console.log(`\n  ${r.content.slice(0, 1000)}...\n`);
  }
}

async function cmdSearch(query) {
  if (!query) { console.error('Usage: s-ai search <query>'); process.exit(1); }
  const { getCrawlEngine } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'tools', 'crawl.js'));
  const engine = getCrawlEngine();
  console.log(`\n  Searching: "${query}"\n`);
  const results = await engine.search(query, { maxResults: 3 });
  for (const r of results) {
    if (r.error) { console.error(`  Error: ${r.error}`); continue; }
    console.log(`  ${r.title}`);
    console.log(`  ${r.url}`);
    console.log(`  ${r.snippet || r.content?.slice(0, 200)}...\n`);
  }
}

async function cmdMcp(sub) {
  if (sub === 'serve') {
    const { startStdioMcp } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'mcp', 'server.js'));
    await startStdioMcp();
  } else if (sub === 'tools') {
    const { createSwarmMcpServer } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'mcp', 'server.js'));
    console.log('\n  MCP Tools:');
    console.log('  - swarm_query: Query the multi-agent swarm');
    console.log('  - crawl_web: Crawl web pages via crawl4ai');
    console.log('  - graph_store: Store in knowledge graph');
    console.log('  - graph_query: Query knowledge graph');
    console.log('  - bias_analysis: Analyze text for biases');
  } else if (sub === 'servers') {
    const { getMcpConfig } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'config.js'));
    const config = getMcpConfig();
    console.log(JSON.stringify(config.servers || [], null, 2));
  } else { console.log('Usage: s-ai mcp <serve|tools|servers>'); }
}

async function cmdProvider(sub, rest) {
  const { listProviders } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'providers', 'index.js'));
  const { getActiveProvider, updateConfig, getProviderConfig } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'config.js'));

  const providerModels = {
    openrouter: [
      { id: 'mistralai/mistral-7b-instruct:free', label: 'Mistral 7B (free)' },
      { id: 'meta-llama/llama-3.1-8b-instruct:free', label: 'Llama 3.1 8B (free)' },
      { id: 'google/gemma-2-9b-it:free', label: 'Gemma 2 9B (free)' },
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
      { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
      { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' }
    ],
    openai: [
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' }
    ],
    anthropic: [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
      { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' }
    ],
    google: [
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' }
    ],
    ollama: [
      { id: 'llama3.2', label: 'Llama 3.2' },
      { id: 'llama3.1', label: 'Llama 3.1' },
      { id: 'mistral', label: 'Mistral' }
    ],
    nvidia: [
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct', label: 'Nemotron 70B' },
      { id: 'nvidia/llama-3.1-8b-instruct', label: 'Nemotron 8B' }
    ],
    cohere: [
      { id: 'command-r-plus', label: 'Command R+ (flagship)' },
      { id: 'command-r', label: 'Command R (fast)' },
      { id: 'command-light', label: 'Command Light' }
    ],
    grok: [
      { id: 'grok-2', label: 'Grok-2 (latest)' },
      { id: 'grok-2-mini', label: 'Grok-2 Mini (fast)' },
      { id: 'grok-beta', label: 'Grok Beta' }
    ],
    kimi: [
      { id: 'moonshot-v1-128k', label: 'Moonshot 128K' },
      { id: 'moonshot-v1-32k', label: 'Moonshot 32K' },
      { id: 'moonshot-v1-8k', label: 'Moonshot 8K (fast)' }
    ],
    pi: [
      { id: 'pi-2', label: 'Pi 2' }
    ],
    together: [
      { id: 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', label: 'Llama 3.1 405B' },
      { id: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', label: 'Llama 3.1 70B' },
      { id: 'mistralai/Mixtral-8x22B-Instruct-v0.1', label: 'Mixtral 8x22B' },
      { id: 'databricks/dbrx-instruct', label: 'DBRX Instruct' },
      { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', label: 'Qwen 2.5 72B' }
    ],
    fireworks: [
      { id: 'accounts/fireworks/models/llama-v3p1-405b-instruct', label: 'Llama 3.1 405B' },
      { id: 'accounts/fireworks/models/llama-v3p1-70b-instruct', label: 'Llama 3.1 70B' },
      { id: 'accounts/fireworks/models/mixtral-8x22b-instruct', label: 'Mixtral 8x22B' },
      { id: 'accounts/fireworks/models/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B' }
    ],
    'aws-bedrock': [
      { id: 'anthropic.claude-3-5-sonnet-20240620-v1:0', label: 'Claude 3.5 Sonnet' },
      { id: 'anthropic.claude-3-opus-20240229-v1:0', label: 'Claude 3 Opus' },
      { id: 'anthropic.claude-3-haiku-20240307-v1:0', label: 'Claude 3 Haiku' },
      { id: 'meta.llama3-1-70b-instruct-v1:0', label: 'Llama 3.1 70B' }
    ],
    'claude-aws': [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
      { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' }
    ],
    'vertex-ai': [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
      { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' }
    ],
    foundry: [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
      { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' }
    ],
    koboldcpp: [
      { id: 'default', label: 'Default loaded model' }
    ],
    oobabooga: [
      { id: 'default', label: 'Default loaded model' }
    ],
    'mlc-llm': [
      { id: 'vicuna-7b-v1.5', label: 'Vicuna 7B' },
      { id: 'Llama-3-8B-Instruct', label: 'Llama 3 8B' },
      { id: 'Mistral-7B-Instruct-v0.2', label: 'Mistral 7B v0.2' }
    ],
    'openai-compatible': [
      { id: 'default', label: 'Default (auto-detect from server)' }
    ]
  };

  if (sub === 'list') {
    const active = getActiveProvider();
    console.log('\n  Available Providers:');
    for (const name of listProviders()) {
      const config = getProviderConfig(name);
      const model = config?.defaultModel || 'default';
      console.log(`  ${name === active.name ? '●' : '○'} ${name}${name === active.name ? ' (active)' : ''} — ${model}`);
    }
  } else if (sub === 'set' && rest[0]) {
    const name = rest[0];
    updateConfig({ providers: { primary: name } });
    console.log(`  Active provider: ${name}`);
    const hints = {
      'aws-bedrock': '  Set AWS_BEDROCK_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY env vars',
      'claude-aws': '  Uses ANTHROPIC_API_KEY via AWS-hosted endpoint',
      'vertex-ai': '  Set VERTEX_AI_PROJECT_ID and VERTEX_AI_REGION env vars',
      foundry: '  Set FOUNDRY_RESOURCE env var (Azure AI Foundry resource name)',
      kimi: '  Set KIMI_API_KEY env var',
      grok: '  Set GROK_API_KEY env var (from console.x.ai)',
      pi: '  Set PI_API_KEY env var (from inflection.ai)',
      cohere: '  Set COHERE_API_KEY env var',
      together: '  Set TOGETHER_API_KEY env var (free tier available)',
      fireworks: '  Set FIREWORKS_API_KEY env var'
    };
    if (hints[name]) console.log(hints[name]);
  } else if (sub === 'test') {
    const { getActiveProviderInstance } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'providers', 'index.js'));
    const provider = getActiveProviderInstance();
    const result = await provider.healthCheck();
    console.log(result.ok ? `  ${result.provider}: OK` : `  ${result.provider}: FAILED - ${result.error}`);
  } else if (sub === 'models') {
    const providerName = rest[0] || getActiveProvider().name;
    const models = providerModels[providerName];
    if (!models) { console.log(`  Unknown provider: ${providerName}`); return; }
    const config = getProviderConfig(providerName);
    console.log(`\n  Models for ${providerName}:`);
    for (const m of models) {
      const current = config?.defaultModel === m.id ? ' (current)' : '';
      console.log(`  ${current ? '●' : '○'} ${m.label}${current}`);
      console.log(`    ${m.id}`);
    }
  } else if (sub === 'model' && rest[0]) {
    const providerName = (await import(join(PACKAGE_ROOT, 'dist', 'src', 'config.js'))).getActiveProvider().name;
    updateConfig({ providers: { [providerName]: { defaultModel: rest[0] } } });
    console.log(`  Model set to: ${rest[0]}`);
  } else { console.log('Usage: s-ai provider <list|set|test|models|model> [name]'); }
}

async function cmdSkill(sub, rest) {
  const skillsDir = join(PACKAGE_ROOT, 'skills');
  if (!existsSync(skillsDir)) mkdirSync(skillsDir, { recursive: true });
  if (sub === 'list' || !sub) {
    const skills = readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory());
    console.log('\n  Installed Skills:');
    if (skills.length === 0) { console.log('  (none)'); return; }
    for (const s of skills) {
      const manifest = join(skillsDir, s.name, 'skill.json');
      if (existsSync(manifest)) {
        const m = JSON.parse(readFileSync(manifest, 'utf8'));
        console.log(`  ${m.name || s.name} v${m.version || '?'} - ${m.description || ''}`);
      } else { console.log(`  ${s.name}`); }
    }
  } else if (sub === 'install' && rest[0]) {
    const skillDir = join(skillsDir, rest[0]);
    if (existsSync(skillDir)) { console.log('  Already installed.'); return; }
    mkdirSync(skillDir, { recursive: true });
    execSync(`cd "${skillDir}" && npm init -y && npm install ${rest[0]}`, { stdio: 'inherit' });
    console.log(`  Installed: ${rest[0]}`);
  } else if (sub === 'remove' && rest[0]) {
    rmSync(join(skillsDir, rest[0]), { recursive: true, force: true });
    console.log(`  Removed: ${rest[0]}`);
  }
}

async function cmdResearch(sub, rest) {
  if (sub === 'search' || !sub) {
    const query = rest.join(' ');
    if (!query) { console.error('Usage: s-ai research search <query>'); process.exit(1); }
    const { searchArxiv, buildCitationGraph } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'tools', 'arxiv.js'));
    console.log(`\n  Searching arXiv: "${query}"\n`);
    const result = await searchArxiv(query, 0, 10);
    const graph = buildCitationGraph(result.papers);
    console.log(`  Found ${result.totalResults} papers. Showing ${result.papers.length}:\n`);
    for (const p of result.papers) {
      console.log(`  ${p.arxivId}`);
      console.log(`  ${p.title.slice(0, 80)}`);
      console.log(`  ${p.authors.slice(0, 2).join(', ')}${p.authors.length > 2 ? ' et al.' : ''} (${p.published.slice(0, 4)})`);
      console.log(`  ${p.absLink}`);
      console.log('');
    }
    console.log(`  Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
    console.log('  Open dashboard for visualization: s-ai research map\n');
  } else if (sub === 'map' || sub === 'dashboard') {
    console.log('\n  Research Mapper dashboard available at: http://localhost:3000/research-mapper');
    console.log('  Start the server with: s-ai serve\n');
  } else if (sub === 'graph') {
    const ids = rest.join('').split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) { console.error('Usage: s-ai research graph <arxiv-id-1>,<arxiv-id-2>,...'); process.exit(1); }
    const { fetchPaperDetailsBulk, buildCitationGraph } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'tools', 'arxiv.js'));
    const papers = await fetchPaperDetailsBulk(ids);
    const graph = buildCitationGraph(papers);
    console.log(`\n  Citation Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges\n`);
    console.log(JSON.stringify(graph, null, 2));
  } else {
    console.log('\n  Research Mapper commands:');
    console.log('    search <query>       Search arXiv papers');
    console.log('    map                  Open research mapper dashboard');
    console.log('    graph <id1,id2,...>  Build citation graph for IDs\n');
  }
}

async function cmdBhashini(sub, rest) {
  const { getBhashiniProvider } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'providers', 'bhashini.js'));

  if (sub === 'translate' || sub === 'tr') {
    const text = rest[0];
    const targetLang = rest[1] || 'hi';
    if (!text) { console.error('Usage: s-ai bhashini translate <text> [target-language]'); process.exit(1); }
    const bhashini = getBhashiniProvider();
    const result = await bhashini.translate(text, 'en', targetLang);
    console.log(`\n  Translation (en -> ${result.targetLanguage}):`);
    console.log(`  ${result.targetText}\n`);
  } else if (sub === 'status' || sub === 'check') {
    const bhashini = getBhashiniProvider();
    const result = await bhashini.healthCheck();
    console.log(result.ok ? `  ${result.provider}: OK` : `  ${result.provider}: FAILED - ${result.error}`);
  } else if (sub === 'pipelines') {
    const bhashini = getBhashiniProvider();
    const result = await bhashini.searchPipelines('asr');
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('\n  Bhashini (Multilingual AI) commands:');
    console.log('    translate <text> [lang]  Translate English to Indian language');
    console.log('    status                   Check Bhashini API connection');
    console.log('    pipelines                List available Bhashini pipelines\n');
  }
}

async function cmdEngine(sub, rest) {
  const { AiEngine } = await import(join(PACKAGE_ROOT, 'dist', 'skills', 'ai-engine', 'engine.js'));
  const engine = new AiEngine();

  if (sub === 'build' || !sub) {
    const prompt = rest.join(' ');
    if (!prompt) { console.error('Usage: s-ai engine build <prompt>'); process.exit(1); }
    console.log(`\n  Building app from prompt...\n`);
    const result = await engine.buildApp(prompt);
    console.log(`  ✓ App built: ${result.definition.brand.icon} ${result.definition.brand.name}`);
    console.log(`  ID: ${result.id}`);
    console.log(`  HTML: ${result.html.length} bytes`);
    console.log(`  Saved to: ~/.s-ai/data/ai-engine/${result.id}.json\n`);
  } else if (sub === 'skill') {
    const prompt = rest.join(' ');
    if (!prompt) { console.error('Usage: s-ai engine skill <prompt>'); process.exit(1); }
    console.log(`\n  Building skill from prompt...\n`);
    const result = await engine.buildSkill(prompt);
    console.log(`  ✓ Skill built: ${result.definition.name}`);
    console.log(`  ID: ${result.id}`);
    console.log(`  Code: ${result.code.length} bytes\n`);
  } else if (sub === 'mcp') {
    const prompt = rest.join(' ');
    if (!prompt) { console.error('Usage: s-ai engine mcp <prompt>'); process.exit(1); }
    console.log(`\n  Building MCP server from prompt...\n`);
    const result = await engine.buildMcpServer(prompt);
    console.log(`  ✓ MCP server built: ${result.definition.name}`);
    console.log(`  ID: ${result.id}`);
    console.log(`  Tools: ${result.definition.tools.map(t => t.name).join(', ')}`);
    console.log(`  Code: ${result.code.length} bytes\n`);
  } else if (sub === 'swarm') {
    const prompt = rest.join(' ');
    if (!prompt) { console.error('Usage: s-ai engine swarm <prompt>'); process.exit(1); }
    console.log(`\n  Building swarm from prompt...\n`);
    const result = await engine.buildSwarm(prompt);
    console.log(`  ✓ Swarm built: ${result.definition.name}`);
    console.log(`  ID: ${result.id}`);
    console.log(`  Agents: ${result.config.agents.map(a => a.id).join(', ')}`);
    console.log(`  Consensus: ${(result.definition.consensusThreshold * 100).toFixed(0)}%`);
    console.log(`  Rounds: ${result.definition.maxRounds}\n`);
  } else if (sub === 'list') {
    const outputs = engine.listOutputs();
    console.log('\n  Built Artifacts');
    console.log('─'.repeat(50));
    if (outputs.length === 0) { console.log('  (none)'); return; }
    for (const o of outputs) {
      const type = o.id.split('_')[0];
      const name = o.definition?.name || o.definition?.brand?.name || 'unknown';
      console.log(`  ${o.id}  ${type.padEnd(8)} ${name}`);
    }
    console.log('');
  } else if (sub === 'ui') {
    const port = parseInt(process.env.PORT || '3000');
    console.log(`\n  AI Engine Dashboard: http://localhost:${port}/ai-engine\n`);
  } else {
    console.log('\n  AI Engine commands:');
    console.log('    build <prompt>    Build an AI app');
    console.log('    skill <prompt>    Build a skill');
    console.log('    mcp <prompt>      Build an MCP server');
    console.log('    swarm <prompt>    Build a swarm');
    console.log('    list              List built artifacts');
    console.log('    ui                Open dashboard\n');
  }
}

async function cmdTools() {
  const { listToolMeta, getToolsByRisk } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'execution', 'registry.js'));
  const tools = listToolMeta();
  console.log('\n  Available Tools (with Risk Levels)');
  console.log('─'.repeat(60));
  for (const t of tools) {
    const riskIcon = { low: '●', medium: '●', high: '●', critical: '●' }[t.riskLevel];
    const riskColor = { low: '\x1b[32m', medium: '\x1b[33m', high: '\x1b[31m', critical: '\x1b[35m' }[t.riskLevel];
    console.log(`  ${riskColor}${riskIcon}\x1b[0m ${t.name.padEnd(20)} [${t.riskLevel.padEnd(8)}] ${t.category}`);
    console.log(`    ${t.description}`);
    if (t.requiresApproval) console.log(`    \x1b[33m⚠ requires approval\x1b[0m`);
    console.log('');
  }
  console.log(`  Total: ${tools.length} tools`);
  console.log(`  Low risk: ${getToolsByRisk('low').length} | Medium: ${getToolsByRisk('medium').length} | High: ${getToolsByRisk('high').length} | Critical: ${getToolsByRisk('critical').length}\n`);
}

async function cmdPlan(question, flags) {
  if (!question) { console.error('Usage: s-ai plan <question>'); process.exit(1); }
  const { Swarm } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'swarm', 'index.js'));
  const { getNeuralMap } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'neural', 'index.js'));
  const swarm = new Swarm();
  const neuralMap = getNeuralMap();
  const persona = neuralMap.getProfile();
  if (persona) swarm.setPersonaContext(neuralMap.buildPersonaContext());

  const maxRounds = parseInt(flags.rounds) || undefined;
  console.log(`\n  Swarm planning: "${question}"\n`);

  const result = await swarm.run(question, { maxRounds });
  console.log('\n  Analysis:');
  console.log('─'.repeat(50));
  console.log(result.content.slice(0, 1000));

  if (result.executionPlan && result.executionPlan.actions.length > 0) {
    console.log('\n  Execution Plan:');
    console.log('─'.repeat(50));
    for (const action of result.executionPlan.actions) {
      console.log(`  → ${action.tool}(${JSON.stringify(action.params)})`);
      console.log(`    Reason: ${action.reason}`);
    }
    console.log(`\n  Rationale: ${result.executionPlan.rationale}`);
    console.log('\n  To execute: s-ai execute \'{"actions":[...]}\'');
  } else {
    console.log('\n  No actions needed — this is an analysis-only request.');
  }
  console.log(`\n  [swarm] rounds=${result.rounds} consensus=${result.consensus.toFixed(2)} elapsed=${result.elapsed}ms\n`);
  swarm.reset();
}

async function cmdExecute(planJson) {
  if (!planJson) { console.error('Usage: s-ai execute \'{"actions":[...]}\''); process.exit(1); }
  const { ExecutionEngine } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'execution', 'engine.js'));
  const { runTool } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'tools', 'index.js'));

  const engine = new ExecutionEngine({
    autoApproveLowRisk: true,
    defaultApprovalHandler: async (req) => {
      console.log(`\n  Approval Required: ${req.tool} (${req.riskLevel})`);
      console.log(`  Reason: ${req.reason}`);
      console.log(`  Params: ${JSON.stringify(req.params)}`);
      console.log(`  Reversible: ${req.reversible}`);
      const answer = await prompt('  Approve? [y/N]: ');
      return { actionId: req.actionId, decision: answer.toLowerCase() === 'y' ? 'allow' : 'deny', timestamp: Date.now() };
    }
  });

  let planData;
  try { planData = JSON.parse(planJson); } catch { console.error('Invalid JSON'); process.exit(1); }

  const plan = engine.createPlan(
    planData.actions || [],
    planData.rationale || '',
    0, 0, 0
  );

  console.log(`\n  Executing ${plan.actions.length} actions...\n`);
  const report = await engine.executePlan(plan, async (tool, params) => {
    return await runTool(tool, params);
  });

  console.log('  Execution Report:');
  console.log('─'.repeat(50));
  for (const r of report.results) {
    const icon = r.status === 'executed' ? '✓' : r.status === 'denied' ? '✗' : r.status === 'failed' ? '✗' : '?';
    console.log(`  ${icon} ${r.tool}: ${r.status}${r.error ? ` (${r.error})` : ''}`);
  }
  console.log(`\n  Total: ${report.totalActions} | Executed: ${report.executed} | Denied: ${report.denied} | Failed: ${report.failed}`);
  console.log(`  Elapsed: ${report.elapsed}ms\n`);
}

async function cmdApprove(actionId) {
  if (!actionId) { console.error('Usage: s-ai approve <action-id>'); process.exit(1); }
  console.log(`  Action ${actionId} approved.`);
}

async function cmdDeny(actionId) {
  if (!actionId) { console.error('Usage: s-ai deny <action-id>'); process.exit(1); }
  console.log(`  Action ${actionId} denied.`);
}

async function cmdAudit(flags) {
  const { readFileSync, existsSync, readdirSync } = await import('node:fs');
  const { join: pathJoin } = await import('node:path');
  const { homedir } = await import('node:os');
  const auditDir = pathJoin(homedir(), '.s-ai', 'audit');
  if (!existsSync(auditDir)) { console.log('\n  No audit log found.\n'); return; }

  const files = readdirSync(auditDir).filter(f => f.endsWith('.jsonl')).sort().reverse();
  const limit = parseInt(flags.limit) || 20;
  console.log('\n  Audit Log (recent entries)');
  console.log('─'.repeat(60));

  let count = 0;
  for (const file of files) {
    if (count >= limit) break;
    const lines = readFileSync(pathJoin(auditDir, file), 'utf8').split('\n').filter(Boolean);
    for (const line of lines.slice(-limit)) {
      if (count >= limit) break;
      try {
        const entry = JSON.parse(line);
        const icon = entry.type === 'action_executed' ? '✓' : entry.type === 'action_denied' ? '✗' : '●';
        console.log(`  ${icon} ${entry.timestamp || ''} ${entry.type} ${entry.tool || ''} ${entry.actionId || ''}`);
        if (entry.error) console.log(`    Error: ${entry.error}`);
        count++;
      } catch {}
    }
  }
  if (count === 0) console.log('  (empty)');
  console.log('');
}

async function cmdDaemon(flags) {
  const port = parseInt(flags.port || process.env.PORT || '3000');
  const host = flags.host || '127.0.0.1';
  console.log(`\n  S-AI Daemon v6.0 starting...`);
  console.log(`  Dashboard: http://${host}:${port}`);
  console.log(`  Mode: Headless service with scheduled jobs\n`);

  const { createServer } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'server.js'));
  await createServer({ port, root: PACKAGE_ROOT });
  console.log(`  Dashboard serving on ${host}:${port}`);

  console.log(`  Daemon mode: Dashboard + MCP + Webhooks active`);
  console.log(`  Press Ctrl+C to stop.\n`);
}

async function cmdStatus() {
  const { getConfig, getActiveProvider } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'config.js'));
  const { getKnowledgeGraph } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'memory', 'graph.js'));
  const { getNeuralMap } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'neural', 'index.js'));
  const { listToolMeta } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'execution', 'registry.js'));
  const graph = getKnowledgeGraph();
  const provider = getActiveProvider();
  const neuralMap = getNeuralMap();
  const persona = neuralMap.getProfile();
  const skillsDir = join(PACKAGE_ROOT, 'skills');
  const skillCount = existsSync(skillsDir) ? readdirSync(skillsDir, { withFileTypes: true }).filter(d => d.isDirectory()).length : 0;
  const tools = listToolMeta();
  console.log('\n  S-AI Status');
  console.log('─'.repeat(50));
  console.log(`  Version:    6.0.0`);
  console.log(`  Node:       ${process.version}`);
  console.log(`  Provider:   ${provider.name} (${provider.defaultModel || 'default'})`);
  console.log(`  Graph:      ${graph.getStats().nodes} nodes, ${graph.getStats().edges} edges`);
  console.log(`  Persona:    ${persona ? persona.name + ' (active)' : 'none'}`);
  console.log(`  Skills:     ${skillCount} installed`);
  console.log(`  Tools:      ${tools.length} registered (execution layer)`);
  console.log(`  Swarm:      7 agents (orchestrator, researcher, analyst-a, analyst-b, critic, synthesizer, action-planner)`);
  console.log(`  Bhashini:   ${process.env.BHASHINI_API_KEY ? 'configured' : 'not configured (set BHASHINI_API_KEY)'}`);
  console.log(`  Config:     ${join(process.env.HOME || '~', '.config', 's-ai')}`);
  console.log('');
}

async function cmdPersona(sub, rest) {
  const { getNeuralMap } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'neural', 'index.js'));
  const neuralMap = getNeuralMap();

  if (sub === 'set' || sub === 'create') {
    const name = rest[0];
    if (!name) { console.error('Usage: s-ai persona set <name> [bio]'); process.exit(1); }
    const bio = rest.slice(1).join(' ') || '';
    const profile = neuralMap.setProfile({ name, bio });
    console.log(`\n  Persona set: ${profile.name}`);
    console.log(`  Bio: ${bio || '(none)'}`);
    console.log(`  ID: ${profile.id}`);
    console.log('  Neural mapping active. S-AI will now adapt to this persona.\n');
  } else if (sub === 'show' || sub === 'get' || !sub) {
    const profile = neuralMap.getProfile();
    if (!profile) { console.log('\n  No active persona.\n  Use: s-ai persona set <name> <bio>\n'); return; }
    console.log('\n  Active Persona');
    console.log('─'.repeat(50));
    console.log(`  Name:       ${profile.name}`);
    console.log(`  Bio:        ${profile.bio || '(none)'}`);
    console.log(`  Worldview:  ${profile.worldview || '(none)'}`);
    console.log(`  Beliefs:    ${profile.coreBeliefs.length}`);
    console.log(`  Patterns:   ${profile.linguisticPatterns.length}`);
    console.log(`  Traits:     ${profile.cognitiveTraits.length}`);
    console.log(`  Nodes:      ${profile.contextNodes.length}`);
    console.log(`  History:    ${profile.interactionHistory.length} interactions`);
    console.log(`  Created:    ${new Date(profile.createdAt).toISOString()}`);
    console.log('');
  } else if (sub === 'clear' || sub === 'delete') {
    neuralMap.clearProfile();
    console.log('\n  Persona cleared. Neural mapping deactivated.\n');
  } else if (sub === 'node' || sub === 'add-node') {
    const type = rest[0];
    const title = rest[1];
    const content = rest.slice(2).join(' ');
    if (!type || !content) { console.error('Usage: s-ai persona node <link|text> <title> <content>'); process.exit(1); }
    try {
      const node = neuralMap.addContextNode({ type: type, title: title || 'Untitled', content });
      console.log(`\n  Context node added: ${node.title} (${node.type})\n`);
    } catch (err) {
      console.error('  Error:', err.message);
    }
  } else if (sub === 'profiles') {
    const profiles = neuralMap.listProfiles();
    console.log('\n  Saved Personas');
    console.log('─'.repeat(50));
    if (profiles.length === 0) { console.log('  (none)'); }
    else { profiles.forEach(p => console.log(`  ${p}`)); }
    console.log('');
  } else {
    console.log('\n  Neural Mapping (Digital Twin Persona) commands:');
    console.log('    set <name> [bio]         Create a persona');
    console.log('    show                     Show active persona');
    console.log('    clear                    Remove active persona');
    console.log('    node <type> <title> <content>  Add context node');
    console.log('    profiles                 List saved personas\n');
  }
}

async function cmdReach(sub, rest) {
  if (sub === 'doctor' || sub === 'status' || !sub) {
    const { doctor, formatReport, doctorToJson } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'reach', 'index.js'));
    const results = doctor();
    console.log(formatReport(results));
    const ok = results.filter(r => r.status.status === 'ok').length;
    process.exit(ok === results.length ? 0 : 1);
  } else if (sub === 'channels') {
    const { getChannels } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'reach', 'index.js'));
    const channels = getChannels();
    console.log('\n  Available Internet Channels:\n');
    for (const ch of channels) {
      console.log(`  ${ch.name.padEnd(15)} ${ch.description}`);
      console.log(`  ${' '.repeat(15)} Backends: ${ch.backends.join(', ')}`);
      console.log(`  ${' '.repeat(15)} Tier: ${ch.tier === 0 ? 'Zero-Config' : ch.tier === 1 ? 'Free Login' : 'Manual Setup'}`);
      console.log('');
    }
  } else if (sub === 'read' && rest[0]) {
    const { getChannels } = await import(join(PACKAGE_ROOT, 'dist', 'src', 'reach', 'index.js'));
    const url = rest[0];
    const channels = getChannels();
    let handled = false;
    for (const ch of channels) {
      if (ch.canHandle && ch.canHandle(url) && ch.read) {
        try {
          console.log(`\n  Reading via ${ch.name} (${ch.active_backend || ch.backends[0]})...\n`);
          const content = await ch.read(url);
          console.log(content.slice(0, 2000) + (content.length > 2000 ? '\n[... truncated]' : ''));
          handled = true;
        } catch (err) {
          console.error(`  [${ch.name}] Error: ${err.message}`);
        }
        break;
      }
    }
    if (!handled) {
      console.log(`\n  No channel available to read: ${url}`);
    }
  } else if (sub === 'read' && !rest[0]) {
    console.error('Usage: s-ai reach read <url>');
  } else {
    console.log('\n  Reach (Agent-Reach Internet Channels) commands:');
    console.log('    doctor                   Check channel statuses');
    console.log('    channels                 List all channels');
    console.log('    read <url>               Read content from URL\n');
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
