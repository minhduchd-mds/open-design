import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

describe('project file version routes', () => {
  let server: http.Server;
  let baseUrl: string;
  const projectsToClean: string[] = [];

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterAll(async () => {
    for (const id of projectsToClean.splice(0)) {
      await fetch(`${baseUrl}/api/projects/${id}`, { method: 'DELETE' }).catch(() => {});
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function createProject(): Promise<string> {
    const id = `file-versions-${randomUUID()}`;
    const response = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, name: 'File version route project' }),
    });
    expect(response.status).toBe(200);
    projectsToClean.push(id);
    return id;
  }

  async function writeProjectFile(projectId: string, name: string, content: string): Promise<void> {
    const response = await fetch(`${baseUrl}/api/projects/${projectId}/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, content }),
    });
    expect(response.status).toBe(200);
  }

  it('lists and restores HTML history after the working file is deleted', async () => {
    const projectId = await createProject();
    await writeProjectFile(projectId, 'brand.html', '<html><body>recover me</body></html>');

    const createResponse = await fetch(`${baseUrl}/api/projects/${projectId}/files/brand.html/versions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Known good checkpoint', source: 'manual' }),
    });
    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as { version: { id: string; size: number } };

    const deleteResponse = await fetch(`${baseUrl}/api/projects/${projectId}/raw/brand.html`, {
      method: 'DELETE',
    });
    expect(deleteResponse.status).toBe(200);

    const listResponse = await fetch(`${baseUrl}/api/projects/${projectId}/files/brand.html/versions`);
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as {
      file: { name: string; size: number; kind: string; mime: string };
      versions: Array<{ id: string; current: boolean; label: string }>;
    };
    expect(listed.file).toMatchObject({
      name: 'brand.html',
      size: created.version.size,
      kind: 'html',
      mime: 'text/html; charset=utf-8',
    });
    expect(listed.versions.length).toBeGreaterThanOrEqual(1);
    const listedCheckpoint = listed.versions.find((version) => version.id === created.version.id);
    expect(listedCheckpoint).toMatchObject({
      id: created.version.id,
      current: true,
      label: 'Known good checkpoint',
    });

    const restoreResponse = await fetch(
      `${baseUrl}/api/projects/${projectId}/files/brand.html/versions/${created.version.id}/restore`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
    );
    expect(restoreResponse.status).toBe(200);

    const rawResponse = await fetch(`${baseUrl}/api/projects/${projectId}/raw/brand.html`);
    expect(rawResponse.status).toBe(200);
    expect(await rawResponse.text()).toBe('<html><body>recover me</body></html>');
  });
});
