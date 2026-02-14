/**
 * SkillManager - Unified skill library and memory manager.
 *
 * Merges two systems:
 * 1. *_skill.md files with keyword matching + Memory Manager (agent_rules.json)
 * 2. pentest-executor's skills.ts: YAML frontmatter .md files with tool-callable operations
 *
 * Provides:
 * - Tool-callable functions for the agentic loop (listSkills, readSkillFile, saveNewSkill)
 * - Keyword-matched skills for the Reasoner (buildSkillContext)
 * - Prompt section builder for the agentic loop (buildSkillsPromptSection)
 * - Memory Manager (addRule, removeRule, listRules, clearRules, buildRulesPromptSection)
 */

import * as fs from 'fs';
import * as path from 'path';
import { SkillIndexEntry } from '../core/types.js';

const TOOL_NAME_RE = /^[a-z0-9\-]+$/;

/**
 * Represents a loaded skill document (MVP convention: *_skill.md).
 */
export interface Skill {
  name: string;
  content: string;
  tools: string[];
}

/**
 * Tool rules/preferences stored in agent_rules.json.
 */
export interface ToolRules {
  [toolName: string]: string[];
}

export class SkillManager {
  private skillsDir: string;
  private rulesPath: string;
  /** MVP-style skills (keyword-matched) */
  private skills: Map<string, Skill> = new Map();

  constructor(skillsDir: string = './src/skills', rulesPath?: string) {
    this.skillsDir = skillsDir;
    this.rulesPath = rulesPath || path.join(path.dirname(skillsDir), 'config', 'agent_rules.json');
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Loads all *_skill.md files from the skills directory (MVP convention).
   */
  async loadSkills(): Promise<void> {
    if (!fs.existsSync(this.skillsDir)) return;

    const files = fs.readdirSync(this.skillsDir);
    for (const file of files) {
      if (file.endsWith('_skill.md')) {
        const skillName = file.replace('_skill.md', '');
        const filePath = path.join(this.skillsDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const tools = this.extractToolNames(content);

        this.skills.set(skillName, { name: skillName, content, tools });
        console.log(`[SkillManager] Loaded skill: ${skillName} (${tools.length} tools)`);
      }
    }
  }

  private extractToolNames(content: string): string[] {
    const tools: string[] = [];
    const toolPatterns = [/Command:\s*(\w+)/g, /Action:\s*(\w+)/g, /use\s+(\w+)/g];

    for (const pattern of toolPatterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && !tools.includes(match[1])) {
          tools.push(match[1]);
        }
      }
    }
    return tools;
  }

  // ============================================================================
  // TOOL-CALLABLE METHODS (for agentic loop)
  // ============================================================================

  /**
   * Lists all skill files (YAML frontmatter .md format).
   * Used by: save_new_skill, read_skill_file, list_skills tools in agentic loop.
   */
  listSkills(): SkillIndexEntry[] {
    if (!fs.existsSync(this.skillsDir)) return [];

    const files = fs.readdirSync(this.skillsDir).filter((f) => f.endsWith('.md'));
    const index: SkillIndexEntry[] = [];

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(this.skillsDir, file), 'utf-8');
        const entry = this.parseFrontmatter(content);
        if (entry) {
          index.push(entry);
        }
      } catch {
        // Skip malformed files
      }
    }
    return index;
  }

  /**
   * Returns the full markdown content of a skill file.
   */
  readSkillFile(toolName: string): string {
    if (!TOOL_NAME_RE.test(toolName)) {
      return `Error: Invalid tool name '${toolName}'. Only [a-z0-9-] allowed.`;
    }

    // Try exact match first (e.g., wpscan.md), then MVP convention (e.g., wpscan_skill.md)
    const candidates = [
      path.join(this.skillsDir, `${toolName}.md`),
      path.join(this.skillsDir, `${toolName}_skill.md`),
    ];

    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8');
      }
    }
    return `Error: No skill file found for '${toolName}'.`;
  }

  /**
   * Writes a new skill file to the skills directory.
   */
  saveNewSkill(toolName: string, content: string): string {
    if (!TOOL_NAME_RE.test(toolName)) {
      return `Error: Invalid tool name '${toolName}'. Only [a-z0-9-] allowed.`;
    }

    if (!fs.existsSync(this.skillsDir)) {
      fs.mkdirSync(this.skillsDir, { recursive: true });
    }

    const filePath = path.join(this.skillsDir, `${toolName}.md`);
    fs.writeFileSync(filePath, content, 'utf-8');
    return `Saved skills/${toolName}.md (${content.length} bytes)`;
  }

  /**
   * Builds the [AVAILABLE SKILLS] prompt section for the agentic loop.
   */
  buildSkillsPromptSection(): string {
    const skills = this.listSkills();
    if (skills.length === 0) {
      return '[AVAILABLE SKILLS]\nNo pre-learned skills available. Use save_new_skill to create them after learning a new tool.\n';
    }

    let section =
      '[AVAILABLE SKILLS]\nYou have pre-learned skills for the following tools. Use read_skill_file(tool_name)\nto load the full usage guide before using any of these:\n';
    for (const s of skills.slice(0, 50)) {
      section += `- ${s.tool_name}: ${s.description} (tags: ${s.tags.join(', ')})\n`;
    }
    return section;
  }

  private parseFrontmatter(content: string): SkillIndexEntry | null {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    const yaml = match[1];
    const get = (key: string): string => {
      const m = yaml.match(new RegExp(`^${key}:\\s*"?(.+?)"?\\s*$`, 'm'));
      return m ? m[1] : '';
    };

    const toolName = get('tool_name');
    if (!toolName) return null;

    const tagsMatch = yaml.match(/^tags:\s*\[(.+?)\]/m);
    const tags = tagsMatch
      ? tagsMatch[1].split(',').map((t) => t.trim().replace(/"/g, ''))
      : [];

    return {
      tool_name: toolName,
      category: get('category'),
      tags,
      description: get('description'),
    };
  }

  // ============================================================================
  // REASONER CONTEXT (keyword-matched skills from MVP convention)
  // ============================================================================

  /**
   * Builds a formatted context string with skills AND rules for the Reasoner.
   */
  buildSkillContext(query: string): string {
    const relevantSkills = this.getRelevantSkills(query);
    const rules = this.loadRules();

    let context = '';

    if (relevantSkills.length > 0) {
      context += '# Available Skills\n\n';
      for (const skill of relevantSkills.slice(0, 3)) {
        context += `## ${skill.name}\n\n${skill.content}\n\n---\n\n`;
      }
    }

    if (Object.keys(rules).length > 0) {
      context += '\n# Tool Preferences (IMPORTANT - Follow these rules)\n\n';
      for (const [tool, toolRules] of Object.entries(rules)) {
        context += `## ${tool}\n`;
        for (const rule of toolRules) {
          context += `- ${rule}\n`;
        }
        context += '\n';
      }
    }

    return context || 'No specific skills or rules loaded for this task.';
  }

  private getRelevantSkills(context: string): Skill[] {
    const keywords = context.toLowerCase().split(/\s+/);
    const relevant: Skill[] = [];

    for (const skill of this.skills.values()) {
      const skillText = skill.content.toLowerCase();
      const score = keywords.filter((kw) => skillText.includes(kw)).length;
      if (score > 0) relevant.push(skill);
    }

    return relevant.sort((a, b) => {
      const scoreA = keywords.filter((kw) => a.content.toLowerCase().includes(kw)).length;
      const scoreB = keywords.filter((kw) => b.content.toLowerCase().includes(kw)).length;
      return scoreB - scoreA;
    });
  }

  // ============================================================================
  // MEMORY MANAGER (persistent tool preferences)
  // ============================================================================

  loadRules(): ToolRules {
    try {
      if (fs.existsSync(this.rulesPath)) {
        return JSON.parse(fs.readFileSync(this.rulesPath, 'utf-8'));
      }
    } catch (error) {
      console.error('[SkillManager] Error loading rules:', error);
    }
    return {};
  }

  private saveRules(rules: ToolRules): void {
    const dir = path.dirname(this.rulesPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.rulesPath, JSON.stringify(rules, null, 2));
  }

  addRule(toolName: string, rule: string): void {
    const rules = this.loadRules();
    if (!rules[toolName]) rules[toolName] = [];
    if (!rules[toolName].includes(rule)) {
      rules[toolName].push(rule);
      this.saveRules(rules);
      console.log(`[SkillManager] Added rule for ${toolName}: ${rule}`);
    }
  }

  removeRule(toolName: string, index: number): boolean {
    const rules = this.loadRules();
    if (rules[toolName] && rules[toolName][index] !== undefined) {
      rules[toolName].splice(index, 1);
      if (rules[toolName].length === 0) delete rules[toolName];
      this.saveRules(rules);
      return true;
    }
    return false;
  }

  listRules(toolName?: string): ToolRules {
    const rules = this.loadRules();
    if (toolName) return { [toolName]: rules[toolName] || [] };
    return rules;
  }

  clearRules(toolName: string): number {
    const rules = this.loadRules();
    const count = rules[toolName]?.length || 0;
    if (count > 0) {
      delete rules[toolName];
      this.saveRules(rules);
    }
    return count;
  }

  /**
   * Builds the rules-only prompt section.
   */
  buildRulesPromptSection(): string {
    const rules = this.loadRules();
    if (Object.keys(rules).length === 0) return '';

    let section = '# Tool Preferences (IMPORTANT - Follow these rules)\n\n';
    for (const [tool, toolRules] of Object.entries(rules)) {
      section += `## ${tool}\n`;
      for (const rule of toolRules) {
        section += `- ${rule}\n`;
      }
      section += '\n';
    }
    return section;
  }

  getRulesPath(): string {
    return this.rulesPath;
  }
}
