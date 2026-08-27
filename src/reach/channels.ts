import { execSync } from 'node:child_process';

export interface ChannelCheck {
  status: 'ok' | 'warn' | 'error' | 'off';
  message: string;
}

export abstract class Channel {
  abstract name: string;
  abstract description: string;
  abstract backends: string[];
  tier: number = 0;
  active_backend: string | null = null;

  abstract check(config?: Record<string, any>): ChannelCheck;

  canHandle?(url: string): boolean;
  read?(url: string): Promise<string>;
}

export class WebChannel extends Channel {
  name = 'web';
  description = 'Any web page via Jina Reader';
  backends = ['Jina Reader'];
  tier = 0;

  check(): ChannelCheck {
    this.active_backend = this.backends[0];
    return { status: 'ok', message: 'Read any webpage via curl https://r.jina.ai/URL' };
  }

  canHandle(): boolean {
    return true;
  }

  async read(url: string): Promise<string> {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const resp = await fetch(jinaUrl, {
      headers: { 'User-Agent': 'S-AI-Reach/1.0', Accept: 'text/plain' },
    });
    if (!resp.ok) throw new Error(`Jina Reader HTTP ${resp.status}`);
    return resp.text();
  }
}

export class YouTubeChannel extends Channel {
  name = 'youtube';
  description = 'YouTube subtitles and search';
  backends = ['yt-dlp'];
  tier = 0;

  check(): ChannelCheck {
    try {
      execSync('yt-dlp --version', { encoding: 'utf-8', timeout: 10000 });
      this.active_backend = 'yt-dlp';
      return { status: 'ok', message: 'yt-dlp available for subtitles and search' };
    } catch {
      return { status: 'warn', message: 'yt-dlp not installed. Install: pip install yt-dlp' };
    }
  }

  canHandle(url: string): boolean {
    return url.includes('youtube.com') || url.includes('youtu.be');
  }

  async read(url: string): Promise<string> {
    try {
      const out = execSync(
        `yt-dlp --dump-json "${url}" 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('title','')); print('\\n'.join(d.get('subtitles',{}).get('en',[{}])[0].get('data','') for _ in [1]) if d.get('subtitles',{}).get('en',[{}])[0].get('data','') else '')"`,
        { encoding: 'utf-8', timeout: 30000 }
      );
      return out || 'No transcript available';
    } catch {
      throw new Error('Failed to extract YouTube content');
    }
  }
}

export class GitHubChannel extends Channel {
  name = 'github';
  description = 'GitHub repositories and search';
  backends = ['gh CLI'];
  tier = 0;

  check(): ChannelCheck {
    try {
      execSync('gh --version', { encoding: 'utf-8', timeout: 10000 });
      this.active_backend = 'gh CLI';
      const hasAuth = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
      if (hasAuth) {
        return { status: 'ok', message: 'gh CLI installed with auth token' };
      }
      return { status: 'ok', message: 'gh CLI installed. Run gh auth login for private repos' };
    } catch {
      return { status: 'warn', message: 'gh CLI not installed. Install: https://cli.github.com' };
    }
  }

  canHandle(url: string): boolean {
    return url.includes('github.com');
  }
}

export class ExaSearchChannel extends Channel {
  name = 'search';
  description = 'Web semantic search via Exa';
  backends = ['mcporter'];
  tier = 0;

  check(): ChannelCheck {
    try {
      execSync('mcporter --version 2>/dev/null || npx --yes mcporter@latest --version', { encoding: 'utf-8', timeout: 15000 });
      this.active_backend = 'mcporter (Exa)';
      return { status: 'ok', message: 'Exa search available via mcporter (free, no key needed)' };
    } catch {
      return { status: 'warn', message: 'mcporter not installed. Run: npm install -g mcporter' };
    }
  }
}

export class RSSChannel extends Channel {
  name = 'rss';
  description = 'RSS/Atom feed reader';
  backends = ['feedparser'];
  tier = 0;

  check(): ChannelCheck {
    try {
      execSync('python3 -c "import feedparser"', { encoding: 'utf-8', timeout: 5000 });
      this.active_backend = 'feedparser';
      return { status: 'ok', message: 'feedparser available for RSS/Atom feeds' };
    } catch {
      return { status: 'warn', message: 'feedparser not installed. Run: pip install feedparser' };
    }
  }
}

export class BilibiliChannel extends Channel {
  name = 'bilibili';
  description = 'Bilibili search and video details';
  backends = ['bili-cli'];
  tier = 0;

  check(): ChannelCheck {
    try {
      execSync('bili --version 2>/dev/null || bili search --help 2>/dev/null', { encoding: 'utf-8', timeout: 10000 });
      this.active_backend = 'bili-cli';
      return { status: 'ok', message: 'bili-cli available for Bilibili search and videos' };
    } catch {
      return { status: 'warn', message: 'bili-cli not installed. Run: pip install bilibili-cli' };
    }
  }
}

export class TwitterChannel extends Channel {
  name = 'twitter';
  description = 'Twitter/X search and timeline';
  backends = ['twitter-cli'];
  tier = 1;

  check(): ChannelCheck {
    try {
      execSync('twitter --version 2>/dev/null || twitter help 2>/dev/null', { encoding: 'utf-8', timeout: 10000 });
      this.active_backend = 'twitter-cli';
      const hasAuth = process.env.TWITTER_AUTH_TOKEN && process.env.TWITTER_CT0;
      if (hasAuth) {
        return { status: 'ok', message: 'twitter-cli installed with cookies' };
      }
      return { status: 'warn', message: 'twitter-cli installed. Configure: export TWITTER_AUTH_TOKEN=... TWITTER_CT0=...' };
    } catch {
      return { status: 'off', message: 'twitter-cli not installed. Run: pip install twitter-cli' };
    }
  }

  canHandle(url: string): boolean {
    return url.includes('twitter.com') || url.includes('x.com');
  }
}

export class RedditChannel extends Channel {
  name = 'reddit';
  description = 'Reddit search and posts';
  backends = ['rdt-cli'];
  tier = 2;

  check(): ChannelCheck {
    try {
      execSync('rdt --version 2>/dev/null || rdt help 2>/dev/null', { encoding: 'utf-8', timeout: 10000 });
      this.active_backend = 'rdt-cli';
      return { status: 'ok', message: 'rdt-cli available (needs login: rdt login)' };
    } catch {
      return { status: 'off', message: 'rdt-cli not installed. Run: pip install rdt-cli' };
    }
  }
}

export class V2EXChannel extends Channel {
  name = 'v2ex';
  description = 'V2EX hot topics and posts';
  backends = ['API'];
  tier = 0;

  check(): ChannelCheck {
    this.active_backend = 'API';
    return { status: 'ok', message: 'V2EX API available (no auth needed)' };
  }
}

export class UnsplashChannel extends Channel {
  name = 'unsplash';
  description = 'Unsplash stock image search';
  backends = ['Jina Reader'];
  tier = 0;

  check(): ChannelCheck {
    this.active_backend = 'Jina Reader';
    return { status: 'ok', message: 'Search Unsplash via Jina Reader (no API key needed)' };
  }

  async search(query: string): Promise<any[]> {
    const url = `https://unsplash.com/s/photos/${encodeURIComponent(query)}`;
    const jinaUrl = `https://r.jina.ai/${url}`;
    const resp = await fetch(jinaUrl, {
      headers: { 'User-Agent': 'S-AI-Reach/1.0', Accept: 'text/plain' },
    });
    if (!resp.ok) throw new Error(`Unsplash search HTTP ${resp.status}`);
    const html = await resp.text();
    const images: any[] = [];
    const imgRegex = /<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"/g;
    let match;
    while ((match = imgRegex.exec(html)) !== null) {
      const src = match[1];
      if (src.includes('images.unsplash.com') && !images.some(i => i.url === src)) {
        images.push({
          url: src,
          thumb: src + '&w=200&h=200&fit=crop',
          small: src + '&w=600',
          alt: match[2] || 'Unsplash image',
          source: 'unsplash',
        });
      }
    }
    return images.slice(0, 30);
  }

  async popular(): Promise<any[]> {
    const url = 'https://unsplash.com';
    const jinaUrl = `https://r.jina.ai/${url}`;
    const resp = await fetch(jinaUrl, {
      headers: { 'User-Agent': 'S-AI-Reach/1.0', Accept: 'text/plain' },
    });
    if (!resp.ok) throw new Error(`Unsplash popular HTTP ${resp.status}`);
    const html = await resp.text();
    const images: any[] = [];
    const imgRegex = /<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"/g;
    let match;
    while ((match = imgRegex.exec(html)) !== null) {
      const src = match[1];
      if (src.includes('images.unsplash.com') && !images.some(i => i.url === src)) {
        images.push({
          url: src,
          thumb: src + '&w=200&h=200&fit=crop',
          small: src + '&w=600',
          alt: match[2] || 'Unsplash image',
          source: 'unsplash',
        });
      }
    }
    return images.slice(0, 30);
  }
}

const ALL_CHANNELS: Channel[] = [
  new WebChannel(),
  new YouTubeChannel(),
  new GitHubChannel(),
  new ExaSearchChannel(),
  new RSSChannel(),
  new BilibiliChannel(),
  new V2EXChannel(),
  new TwitterChannel(),
  new RedditChannel(),
  new UnsplashChannel(),
];

export function getChannels(): Channel[] {
  return ALL_CHANNELS;
}

export function getChannel(name: string): Channel | undefined {
  return ALL_CHANNELS.find(c => c.name === name);
}
