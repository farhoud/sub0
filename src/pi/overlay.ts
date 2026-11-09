// @sigil implements design/pi-driver.sigil PiDriver (skill overlay)
//
// Copies each declared skill folder side by side into skills/ inside the driver-files
// folder the child port hands over, so relative paths between sibling skills
// keep working. The overlay is never removed while its task record exists: pi
// ignores a missing --skill path silently, and an attached session would lose it.
import { cpSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { SkillRef } from '../config/agent-config.js';

export function overlayFolder(driverFilesFolder: string): string {
  return path.join(driverFilesFolder, 'skills');
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

export function prepareOverlay(driverFilesFolder: string, skills: SkillRef[]): string[] {
  const root = overlayFolder(driverFilesFolder);
  return skills.map((skill) => {
    const target = path.join(root, skill.name);
    if (!existsSync(target)) cpSync(skill.folder, target, { recursive: true, dereference: true });
    return target;
  });
}
