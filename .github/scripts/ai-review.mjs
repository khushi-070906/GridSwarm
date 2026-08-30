import fs from 'node:fs';

// Uses GitHub Models — a free inference API included with every GitHub
// account. Auth is the workflow's built-in GITHUB_TOKEN, no secret to add.
// Docs: https://docs.github.com/en/github-models
const token = process.env.GITHUB_TOKEN;
const model = process.env.MODELS_MODEL || 'openai/gpt-4o-mini';
const endpoint = 'https://models.github.ai/inference/chat/completions';

if (!token) {
  fs.writeFileSync('review_output.md', '_Skipped: no GITHUB_TOKEN available to call GitHub Models._');
  process.exit(0);
}

const diff = fs.existsSync('diff_truncated.txt')
  ? fs.readFileSync('diff_truncated.txt', 'utf8')
  : '';

if (!diff.trim()) {
  fs.writeFileSync('review_output.md', '_No reviewable changes found in the diff._');
  process.exit(0);
}

const systemPrompt = `You are a senior software engineer reviewing a pull request diff for an open-source repository.
Review for: correctness bugs, security issues, edge cases, unclear naming, missing tests, and real style problems.
Do NOT comment on things a linter/formatter would already catch (indentation, trailing whitespace, quote style).
Be concise and specific: reference file paths and short line context, not full code blocks.
If the diff looks fine, say so briefly instead of inventing nitpicks.

Output valid Markdown with exactly this structure:
### Summary
One or two sentences on what the PR does.

### Findings
- Concrete issues, or "No blocking issues found" if there are none.

### Suggestions
- Optional, non-blocking improvements. Omit this section if you have none.`;

let res;
try {
  res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Here is the PR diff:\n\n\`\`\`diff\n${diff}\n\`\`\`` },
      ],
    }),
  });
} catch (err) {
  fs.writeFileSync('review_output.md', `_Review failed: network error calling GitHub Models (${err.message})._`);
  process.exit(0);
}

if (!res.ok) {
  const text = await res.text();
  fs.writeFileSync('review_output.md', `_Review failed: ${res.status} ${text.slice(0, 300)}_`);
  process.exit(0);
}

const data = await res.json();
const text = data.choices?.[0]?.message?.content;

fs.writeFileSync('review_output.md', text || '_No review text returned._');
