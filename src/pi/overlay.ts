// @sigil implements design/pi-driver.sigil PiDriver (skill overlay)
//
// Copies each declared skill folder side by side into
// .agents/subzero/tasks/<task id>/skills/, so relative paths between sibling skills
// keep working. The overlay is never removed while its task record exists: pi
// ignores a missing --skill path silently, and an attached session would lose it.
import { cpSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { SkillRef } from '../config/agent-config.js';

export function overlayFolder(projectRoot: string, taskId: string): string {
  return path.join(projectRoot, '.agents', 'subzero', 'tasks', taskId, 'skills');
}

export function missingSkills(skills: SkillRef[]): SkillRef[] {
  return skills.filter((skill) => {
    try {
      return !statSync(skill.folder).isDirectory();
    } catch {
      return true;
    }
  });
}

export function prepareOverlay(projectRoot: string, taskId: string, skills: SkillRef[]): string[] {
  const root = overlayFolder(projectRoot, taskId);
  return skills.map((skill) => {
    const target = path.join(root, skill.name);
    if (!existsSync(target)) cpSync(skill.folder, target, { recursive: true, dereference: true });
    return target;
  });
}
