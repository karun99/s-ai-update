import { z } from 'zod';

const MENTOR_MODES: Record<string, { label: string; system: string }> = {
  homework: {
    label: 'Homework Helper',
    system: 'You are Study Buddy, a peer-styled homework helper. Help students understand concepts step-by-step. Be encouraging, use simple language, and give practical examples. Never do the work for them — guide them to the answer.'
  },
  explain: {
    label: 'Topic Explainer',
    system: 'You are Study Buddy, a topic explainer. Break down complex topics into simple, clear explanations. Use analogies and real-world examples. Keep it conversational and friendly.'
  },
  career: {
    label: 'Career Expert',
    system: 'You are Study Buddy, a career guidance expert. Help students with career paths, skill development, and professional growth. Be practical and encouraging.'
  },
  resume: {
    label: 'Resume Review',
    system: 'You are Study Buddy, a resume analyst. Review resumes against job requirements and provide specific, actionable improvement suggestions.'
  },
  references: {
    label: 'Reference Generator',
    system: 'You are Study Buddy, an academic reference generator. Create properly formatted references in APA, MLA, or Chicago style.'
  },
  pitch: {
    label: 'Pitch Generator',
    system: 'You are Study Buddy, a pitch generator. Help students develop compelling project pitches with: Title, Problem, Solution, Features, Audience, Impact.'
  }
};

const TOPICS = [
  'The Basics', 'Numbers', 'Words', 'Colors', 'Shapes', 'Animals',
  'Plants', 'Space', 'Weather', 'Music', 'Food', 'History',
  'Geography', 'Science', 'Math'
];

const EVOLUTIONS = [
  { level: 1, name: 'Dunce Twin', title: 'The Beginner', emoji: '🧠' },
  { level: 2, name: 'Curious Sprout', title: 'The Learner', emoji: '🌿' },
  { level: 3, name: 'Bright Star', title: 'The Thinker', emoji: '🌟' },
  { level: 5, name: 'Spark Wizard', title: 'The Smart One', emoji: '⚡' },
  { level: 10, name: 'Ember Mage', title: 'The Wise One', emoji: '🔥' },
  { level: 20, name: 'Wave Sage', title: 'The Master', emoji: '🌊' },
  { level: 50, name: 'Royal Scholar', title: 'The Legend', emoji: '👑' }
];

interface KnowledgeEntry { q: string; a: string; }

function parseKnowledgeBase(text: string): KnowledgeEntry[] {
  return text.split('\n').filter(l => l.trim()).map(l => {
    const parts = l.split(/[—\-:;.]/);
    if (parts.length >= 2) {
      const q = parts[0].trim();
      const a = parts.slice(1).join(' ').trim();
      if (q.length > 3 && a.length > 1) return { q, a };
    }
    return null;
  }).filter(Boolean) as KnowledgeEntry[];
}

function generateQuiz(kb: KnowledgeEntry[], used: Set<string>): KnowledgeEntry | null {
  const available = kb.filter(e => !used.has(e.q));
  if (!available.length) return null;
  return available[Math.floor(Math.random() * available.length)];
}

function formatReferences(sources: Array<{ title: string; authors: string[]; year: string; url?: string }>, style: string): string {
  return sources.map(s => {
    const authorStr = s.authors.join(', ');
    switch (style.toLowerCase()) {
      case 'mla':
        return `${authorStr}. "${s.title}." ${s.year}.${s.url ? ` ${s.url}` : ''}`;
      case 'chicago':
        return `${authorStr}. "${s.title}." ${s.year}.${s.url ? ` ${s.url}` : ''}`;
      case 'apa':
      default:
        return `${authorStr} (${s.year}). ${s.title}.${s.url ? ` ${s.url}` : ''}`;
    }
  }).join('\n\n');
}

function register(mcp: any): void {
  mcp.tool(
    'generate_quiz',
    'Generate a quiz question from a knowledge base. Returns a question and checks the user answer.',
    {
      knowledgeBase: z.string().describe('Knowledge base text, one Q-A per line separated by dash or colon'),
      previousAnswers: z.array(z.string()).optional().describe('Questions already asked to avoid repetition')
    },
    async ({ knowledgeBase, previousAnswers }: { knowledgeBase: string; previousAnswers?: string[] }) => {
      const kb = parseKnowledgeBase(knowledgeBase);
      const used = new Set(previousAnswers ?? []);
      const entry = generateQuiz(kb, used);
      if (!entry) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'All questions exhausted. Add more to the knowledge base.', totalQuestions: kb.length }) }] };
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            question: entry.q,
            hint: `Think about the key term in the question...`,
            totalAvailable: kb.length,
            askedSoFar: used.size
          }, null, 2)
        }]
      };
    }
  );

  mcp.tool(
    'check_answer',
    'Check if a user answer is correct against the expected answer. Provides feedback.',
    {
      question: z.string().describe('The quiz question'),
      userAnswer: z.string().describe('The user answer to check'),
      expectedAnswer: z.string().describe('The correct answer')
    },
    async ({ question, userAnswer, expectedAnswer }: { question: string; userAnswer: string; expectedAnswer: string }) => {
      const normalize = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
      const isCorrect = normalize(userAnswer) === normalize(expectedAnswer) ||
        normalize(userAnswer).includes(normalize(expectedAnswer)) ||
        normalize(expectedAnswer).includes(normalize(userAnswer));
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            correct: isCorrect,
            userAnswer,
            expectedAnswer,
            feedback: isCorrect
              ? 'Correct! Great job!'
              : `Not quite. The answer is: ${expectedAnswer}. Keep learning!`
          }, null, 2)
        }]
      };
    }
  );

  mcp.tool(
    'get_evolution',
    'Get the study buddy evolution stage based on current level. Shows avatar, name, and title.',
    {
      level: z.number().describe('Current user level')
    },
    async ({ level }: { level: number }) => {
      let current = EVOLUTIONS[0];
      for (const e of EVOLUTIONS) {
        if (level >= e.level) current = e;
      }
      const nextIdx = EVOLUTIONS.findIndex(e => e.level === current.level) + 1;
      const next = nextIdx < EVOLUTIONS.length ? EVOLUTIONS[nextIdx] : null;
      const xpForNext = next ? next.level * 20 : null;
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            current,
            next,
            xpForNextLevel: xpForNext,
            topics: TOPICS
          }, null, 2)
        }]
      };
    }
  );

  mcp.tool(
    'format_references',
    'Format academic references in APA, MLA, or Chicago style.',
    {
      sources: z.array(z.object({
        title: z.string(),
        authors: z.array(z.string()),
        year: z.string(),
        url: z.string().optional()
      })).describe('List of sources to format'),
      style: z.enum(['apa', 'mla', 'chicago']).optional().default('apa').describe('Citation style')
    },
    async ({ sources, style }: { sources: Array<{ title: string; authors: string[]; year: string; url?: string }>; style?: string }) => {
      const formatted = formatReferences(sources, style ?? 'apa');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            style: style ?? 'apa',
            formatted,
            count: sources.length
          }, null, 2)
        }]
      };
    }
  );

  mcp.tool(
    'generate_pitch',
    'Generate a structured project pitch with Title, Problem, Solution, Features, Audience, and Impact sections.',
    {
      idea: z.string().describe('The project idea or concept')
    },
    async ({ idea }: { idea: string }) => {
      const pitch = {
        title: `Project: ${idea.slice(0, 60)}`,
        problem: `What problem does "${idea}" solve? Who faces this problem and why is it important?`,
        solution: `How does "${idea}" address this problem? What makes it unique?`,
        features: [
          'Feature 1: Core functionality',
          'Feature 2: User experience',
          'Feature 3: Scalability'
        ],
        audience: 'Primary users and target market segments',
        impact: 'Expected outcomes, metrics for success, and long-term vision',
        note: 'Use the PDF or PPTX export in the dashboard to create a presentation deck.'
      };
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(pitch, null, 2)
        }]
      };
    }
  );

  mcp.prompt(
    'study_session',
    'Start a study session with the buddy',
    {
      mode: z.enum(['teach', 'homework', 'explain', 'career', 'resume', 'references', 'pitch']).optional().describe('Study mode')
    },
    ({ mode }: { mode?: string }) => {
      const m = mode && MENTOR_MODES[mode] ? MENTOR_MODES[mode] : MENTOR_MODES.explain;
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Start a ${m.label} session. I'm ready to ${mode === 'teach' ? 'teach you something' : 'get help'}.`
          }
        }]
      };
    }
  );
}

export { register, parseKnowledgeBase, generateQuiz, formatReferences, EVOLUTIONS, TOPICS, MENTOR_MODES };
