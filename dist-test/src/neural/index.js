import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir } from '../config.js';
function getNeuralDir() {
    const dir = join(getDataDir(), 'neural');
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    return dir;
}
function getPersonaPath(id) {
    const dir = getNeuralDir();
    return join(dir, `${id || 'default'}.json`);
}
function loadPersona(id) {
    const path = getPersonaPath(id);
    if (!existsSync(path))
        return null;
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        return null;
    }
}
function savePersona(profile) {
    const path = getPersonaPath(profile.id);
    writeFileSync(path, JSON.stringify(profile, null, 2));
}
function generateId() {
    return `persona_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
class NeuralMap {
    profile;
    config;
    constructor(config = {}) {
        this.config = {
            enabled: true,
            maxHistory: 50,
            autoProfile: false,
            persistAcrossSessions: true,
            ...config
        };
        this.profile = loadPersona();
    }
    getProfile() {
        return this.profile;
    }
    setProfile(data) {
        const now = Date.now();
        if (this.profile) {
            this.profile = {
                ...this.profile,
                ...data,
                updatedAt: now
            };
        }
        else {
            this.profile = {
                id: generateId(),
                name: data.name || 'User',
                bio: data.bio || '',
                worldview: data.worldview || '',
                coreBeliefs: data.coreBeliefs || [],
                linguisticPatterns: data.linguisticPatterns || [],
                cognitiveTraits: data.cognitiveTraits || [],
                communicationStyle: data.communicationStyle || {
                    formality: 0.5,
                    verbosity: 0.5,
                    technicality: 0.5,
                    emotionalExpressiveness: 0.5,
                    preferredTone: 'neutral'
                },
                contextNodes: data.contextNodes || [],
                interactionHistory: data.interactionHistory || [],
                createdAt: this.profile?.createdAt || now,
                updatedAt: now
            };
        }
        if (this.config.persistAcrossSessions) {
            savePersona(this.profile);
        }
        return this.profile;
    }
    clearProfile() {
        this.profile = null;
        const path = getPersonaPath();
        if (existsSync(path)) {
            rmSync(path);
        }
    }
    addContextNode(node) {
        if (!this.profile)
            throw new Error('No persona profile loaded');
        const newNode = {
            ...node,
            id: `node_${Date.now().toString(36)}`,
            timestamp: Date.now()
        };
        this.profile.contextNodes.push(newNode);
        this.profile.updatedAt = Date.now();
        if (this.config.persistAcrossSessions)
            savePersona(this.profile);
        return newNode;
    }
    removeContextNode(id) {
        if (!this.profile)
            return false;
        const before = this.profile.contextNodes.length;
        this.profile.contextNodes = this.profile.contextNodes.filter(n => n.id !== id);
        if (this.profile.contextNodes.length < before) {
            this.profile.updatedAt = Date.now();
            if (this.config.persistAcrossSessions)
                savePersona(this.profile);
            return true;
        }
        return false;
    }
    addInteraction(userMessage, agentResponse, sentiment = 'neutral') {
        if (!this.profile)
            return;
        this.profile.interactionHistory.push({
            timestamp: Date.now(),
            userMessage,
            agentResponse,
            sentiment
        });
        if (this.profile.interactionHistory.length > (this.config.maxHistory || 50)) {
            this.profile.interactionHistory = this.profile.interactionHistory.slice(-(this.config.maxHistory || 50));
        }
        this.profile.updatedAt = Date.now();
        if (this.config.persistAcrossSessions)
            savePersona(this.profile);
    }
    buildPersonaContext() {
        if (!this.profile)
            return '';
        const lines = [];
        lines.push(`USER PERSONA: ${this.profile.name}`);
        lines.push(`Bio: ${this.profile.bio}`);
        if (this.profile.worldview)
            lines.push(`Worldview: ${this.profile.worldview}`);
        if (this.profile.coreBeliefs.length > 0) {
            lines.push(`Core Beliefs: ${this.profile.coreBeliefs.join('; ')}`);
        }
        if (this.profile.linguisticPatterns.length > 0) {
            lines.push(`Communication Patterns: ${this.profile.linguisticPatterns.join('; ')}`);
        }
        if (this.profile.cognitiveTraits.length > 0) {
            lines.push(`Cognitive Traits: ${this.profile.cognitiveTraits.map(t => `${t.name} (${(t.weight * 100).toFixed(0)}%: ${t.description})`).join('; ')}`);
        }
        const cs = this.profile.communicationStyle;
        lines.push(`Communication Style: formality=${(cs.formality * 100).toFixed(0)}%, technicality=${(cs.technicality * 100).toFixed(0)}%, emotional_expression=${(cs.emotionalExpressiveness * 100).toFixed(0)}%, tone=${cs.preferredTone}`);
        if (this.profile.contextNodes.length > 0) {
            lines.push(`Context Nodes:`);
            for (const node of this.profile.contextNodes) {
                lines.push(`  - [${node.type}] ${node.title}: ${node.content.substring(0, 200)}`);
            }
        }
        if (this.profile.interactionHistory.length > 0) {
            const recent = this.profile.interactionHistory.slice(-5);
            lines.push(`Recent Interaction Patterns:`);
            for (const rec of recent) {
                lines.push(`  - User said something ${rec.sentiment}, AI responded`);
            }
        }
        return lines.join('\n');
    }
    buildSystemPromptDirective() {
        if (!this.profile)
            return '';
        return `PERSONA ADAPTATION MODULE:
You have access to a neural mapping of the user "${this.profile.name}". Adapt your responses accordingly:
- Mirror their communication style (formality: ${(this.profile.communicationStyle.formality * 100).toFixed(0)}%, technicality: ${(this.profile.communicationStyle.technicality * 100).toFixed(0)}%)
- Acknowledge their worldview and core beliefs when relevant
- Use their preferred tone: ${this.profile.communicationStyle.preferredTone}
- Reference their context nodes when discussing related topics
- Build on their interaction history patterns
- Never fabricated information about the user; only use what is provided in the neural map

${this.buildPersonaContext()}`;
    }
    analyzeSentiment(text) {
        const lower = text.toLowerCase();
        const positive = ['happy', 'great', 'excellent', 'love', 'amazing', 'wonderful', 'good', 'thank', 'please', 'help', 'agree', 'yes', 'right'];
        const negative = ['angry', 'bad', 'terrible', 'hate', 'awful', 'wrong', 'no', 'never', 'worst', 'disappointed', 'frustrated', 'error', 'fail'];
        const pScore = positive.filter(w => lower.includes(w)).length;
        const nScore = negative.filter(w => lower.includes(w)).length;
        if (pScore > nScore + 1)
            return 'positive';
        if (nScore > pScore + 1)
            return 'negative';
        if (pScore > 0 && nScore > 0)
            return 'mixed';
        return 'neutral';
    }
    listProfiles() {
        const dir = getNeuralDir();
        if (!existsSync(dir))
            return [];
        return readdirSync(dir)
            .filter(f => f.endsWith('.json'))
            .map(f => f.replace('.json', ''));
    }
    loadProfileById(id) {
        return loadPersona(id);
    }
    isEnabled() {
        return this.config.enabled !== false;
    }
}
let _instance = null;
function getNeuralMap(config) {
    if (!_instance)
        _instance = new NeuralMap(config);
    return _instance;
}
export { NeuralMap, getNeuralMap };
//# sourceMappingURL=index.js.map