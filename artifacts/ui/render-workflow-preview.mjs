import { createServer } from 'vite';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', resolve: { alias: { '@': resolve('.') } }, esbuild: { jsx: 'automatic' } });
try {
 const { WorkflowOverview } = await server.ssrLoadModule('/app/(app)/workflow/WorkflowOverview.tsx');
 const html = renderToStaticMarkup(React.createElement(WorkflowOverview, { onAssignments: () => {} }));
 await writeFile('artifacts/ui/workflow-overview-preview.html', '<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="workflow-preview.css"></head><body class="bg-background text-foreground"><main style="max-width:1240px;margin:32px auto;padding:0 24px">'+html+'</main></body></html>','utf8');
 process.stdout.write('Rendered workflow overview preview.\n');
} finally { await server.close(); }
