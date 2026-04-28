import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';

const allowedDocs = new Set([
  'README.md',
  'device-onboarding.md',
  'install.md',
  'linux-install.md',
  'recovery.md',
  'troubleshooting.md',
  'upgrade.md',
]);

function normalizeSlug(slug: string) {
  return slug.endsWith('.md') ? slug : `${slug}.md`;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const docName = normalizeSlug(slug);
  if (!allowedDocs.has(docName)) {
    return new Response('Not found', { status: 404 });
  }

  const filePath = path.join(process.cwd(), '..', 'docs', 'runbook', docName);
  const body = await readFile(filePath, 'utf8');
  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
