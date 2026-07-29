import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertValidProject } from './schema.js';

export const PROJECT_FILE_NAME = 'project.json';

export function serializeProject(project) {
  assertValidProject(project);
  return `${JSON.stringify(project, null, 2)}\n`;
}

export function deserializeProject(text) {
  const project = JSON.parse(text);
  return assertValidProject(project);
}

export async function saveProject(projectDirectory, project) {
  await mkdir(projectDirectory, { recursive: true });
  const filePath = path.join(projectDirectory, PROJECT_FILE_NAME);
  await writeFile(filePath, serializeProject(project), 'utf8');
  return filePath;
}

export async function loadProject(projectDirectory) {
  const filePath = path.join(projectDirectory, PROJECT_FILE_NAME);
  return deserializeProject(await readFile(filePath, 'utf8'));
}
