import { z } from 'zod';

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1/chat/completions';
const NVIDIA_INVOKE_URL = 'https://ai.api.nvidia.com/v1/cosmos/nvidia/cosmos-1.0-7b-diffusion-text2world';
const NVIDIA_STATUS_URL = 'https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/';

function getApiKey(name: string): string {
  return process.env[name] || '';
}

function register(mcp: any, skill: any): void {
  mcp.tool(
    'refine_prompt',
    'Refine a rough video idea into a detailed prompt for text-to-video AI using OpenRouter.',
    { idea: z.string().describe('Rough video idea (e.g. "a cat jumping over a rainbow at sunset")') },
    async ({ idea }: { idea: string }) => {
      const key = getApiKey('OPENROUTER_API_KEY');
      if (!key) {
        return { content: [{ type: 'text' as const, text: 'Error: OPENROUTER_API_KEY not set' }] };
      }

      try {
        const res = await fetch(OPENROUTER_API_BASE, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'openrouter/free',
            messages: [
              {
                role: 'system',
                content:
                  'You write concise, vivid prompts for text-to-video AI models. ' +
                  'Given a rough idea, output ONE refined prompt (2-3 sentences max) ' +
                  'describing subject, setting, camera movement, and mood. ' +
                  'Only use original/generic subjects. Output only the prompt, no preamble.',
              },
              { role: 'user', content: idea },
            ],
            max_tokens: 150,
          }),
        });

        if (!res.ok) {
          return { content: [{ type: 'text' as const, text: `OpenRouter error ${res.status}: ${await res.text()}` }] };
        }

        const data: any = await res.json();
        const prompt = data.choices?.[0]?.message?.content?.trim() || '';
        return { content: [{ type: 'text' as const, text: prompt }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    }
  );

  mcp.tool(
    'generate_video',
    'Generate a video from a refined prompt using NVIDIA AI. Polls until complete (up to 5 min).',
    { prompt: z.string().describe('The refined video prompt') },
    async ({ prompt }: { prompt: string }) => {
      const key = getApiKey('NVIDIA_API_KEY');
      if (!key) {
        return { content: [{ type: 'text' as const, text: 'Error: NVIDIA_API_KEY not set' }] };
      }

      try {
        const payload = {
          inputs: [
            { name: 'text2world', shape: [1], datatype: 'BYTES', data: [`text2world --prompt="${prompt}"`] },
          ],
          outputs: [{ name: 'status', datatype: 'BYTES', shape: [1] }],
        };

        const headers = {
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        };

        let res = await fetch(NVIDIA_INVOKE_URL, { method: 'POST', headers, body: JSON.stringify(payload) });

        if (!res.ok) {
          return { content: [{ type: 'text' as const, text: `NVIDIA error ${res.status}: ${await res.text()}` }] };
        }

        let attempts = 0;
        while (res.status === 202 && attempts < 60) {
          const requestId = res.headers.get('NVCF-REQID');
          if (!requestId) {
            return { content: [{ type: 'text' as const, text: 'Error: No NVCF-REQID header' }] };
          }
          await new Promise((r) => setTimeout(r, 5000));
          res = await fetch(NVIDIA_STATUS_URL + requestId, { method: 'GET', headers });
          if (!res.ok) break;
          attempts++;
        }

        if (res.status === 202) {
          return { content: [{ type: 'text' as const, text: 'Video generation timed out after 5 minutes' }] };
        }

        const data: any = await res.json();
        const videoUrl = data.video || data.video_url || (data.b64_video ? `data:video/mp4;base64,${data.b64_video}` : null);

        if (videoUrl) {
          return { content: [{ type: 'text' as const, text: videoUrl }] };
        }

        return { content: [{ type: 'text' as const, text: `Unexpected response: ${JSON.stringify(Object.keys(data))}` }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    }
  );

  mcp.tool(
    'add_title_overlay',
    'Generate instructions for adding a title overlay to a video using FFmpeg drawtext filter.',
    { title: z.string().describe('Title text to overlay') },
    async ({ title }: { title: string }) => {
      const ffmpegCmd = `ffmpeg -i input.mp4 -vf "drawtext=text='${title}':fontcolor=white:fontsize=36:box=1:boxcolor=black@0.5:boxborderw=10:x=(w-text_w)/2:y=h-th-40:enable='between(t,0,3)'" -c:a copy output.mp4`;
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              description: 'Run this FFmpeg command to add a title overlay to your video',
              command: ffmpegCmd,
              note: 'Install ffmpeg locally or use @ffmpeg/ffmpeg WASM in the browser',
            }, null, 2),
          },
        ],
      };
    }
  );

  mcp.prompt(
    'video_idea',
    'Walk through describing a video idea for AI generation',
    { idea: z.string().describe('Rough video idea').optional() },
    ({ idea }: { idea?: string }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: idea
              ? `Help me generate a video for this idea: ${idea}. First refine the prompt, then generate the video, then optionally add a title overlay.`
              : 'I want to generate an AI video. Help me describe what I want to create. What subject, setting, and mood should the video have?',
          },
        },
      ],
    })
  );
}

export { register };
