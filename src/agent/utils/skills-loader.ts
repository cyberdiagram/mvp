/**
 * SkillsLoader - Dynamic skill and rule management for the pentest agent.
 *
 * This module provides two key functionalities:
 * 1. **Skills Loading**: Loads domain knowledge from *_skill.md files
 * 2. **Memory Manager**: Persists user preferences for tool usage (CLAUDE.md-style)
 *
 * The Memory Manager follows Anthropic's Claude Code architecture pattern of
 * "soft prompts" over "hard code" - preferences are injected into the LLM
 * context rather than hardcoded into tool implementations.
 *
 * @module skillsLoader
 * @author Leo
 * @version 1.1
 * @date 2026-02-05
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Represents a loaded skill document.
 *
 * Skills are markdown files that contain domain knowledge and tool usage
 * guidance for specific security tools (e.g., nmap_skill.md).
 *
 * @interface Skill
 * @property {string} name - Skill name derived from filename (e.g., "nmap" from "nmap_skill.md")
 * @property {string} content - Full markdown content of the skill document
 * @property {string[]} tools - Tool names extracted from the skill (e.g., ["nmap_host_discovery"])
 */
export interface Skill {
  /** Skill name derived from filename (e.g., "nmap" from "nmap_skill.md") */
  name: string;
  /** Full markdown content of the skill document */
  content: string;
  /** Tool names extracted from the skill (e.g., ["nmap_host_discovery", "nmap_port_scan"]) */
  tools: string[];
}

/**
 * Represents tool-specific rules/preferences stored in agent_rules.json.
 *
 * @interface ToolRules
 * @example
 * {
 *   "nmap": ["Always use -Pn after host discovery"],
 *   "gobuster": ["Use -t 50 for faster enumeration"]
 * }
 */
export interface ToolRules {
  [toolName: string]: string[];
}

/**
 * SkillsLoader - Dynamic skill and rule management for the pentest agent.
 *
 * This class provides two main functionalities:
 *
 * **1. Skills Management:**
 * - Loads skill documents from *_skill.md files
 * - Matches skills to context via keyword relevance
 * - Injects skill content into the Reasoner's system prompt
 *
 * **2. Memory Manager (CLAUDE.md-style preferences):**
 * - Persists user tool preferences to agent_rules.json
 * - Loads rules and injects them into LLM context
 * - Allows dynamic rule management (add, remove, list)
 *
 * @class SkillsLoader
 *
 * @example
 * const loader = new SkillsLoader('./skills');
 * await loader.loadSkills();
 *
 * // Memory Manager usage
 * loader.addRule('nmap', 'Always use -Pn after host discovery');
 * const rules = loader.listRules('nmap');
 *
 * // Build context for LLM
 * const context = loader.buildSkillContext('reconnaissance scan');
 */
export class SkillsLoader {
  /** Path to the skills directory containing *_skill.md files */
  private skillsDir: string;

  /** Map of loaded skills, keyed by skill name */
  private skills: Map<string, Skill> = new Map();

  /** Path to the agent_rules.json file for persistent rule storage */
  private rulesPath: string;

  /**
   * Creates a new SkillsLoader instance.
   *
   * Initializes paths for both skills directory and rules file.
   * The rules file is stored at `../config/agent_rules.json` relative to skills dir.
   *
   * @constructor
   * @param {string} skillsDir - Path to directory containing *_skill.md files
   *
   * @example
   * const loader = new SkillsLoader('./src/skills');
   */
  constructor(skillsDir: string = './skills') {
    this.skillsDir = skillsDir;
    // Rules file is in config directory, sibling to skills
    this.rulesPath = path.join(path.dirname(skillsDir), 'config', 'agent_rules.json');
  }

  // ============================================================================
  // SKILLS MANAGEMENT METHODS
  // ============================================================================

  /**
   * Loads all skill documents from the skills directory.
   *
   * Scans for files matching *_skill.md pattern, reads their content,
   * extracts tool names mentioned within, and stores them for later use.
   *
   * This method should be called during agent initialization before
   * any reasoning or tool execution occurs.
   *
   * @async
   * @returns {Promise<void>}
   *
   * @example
   * const loader = new SkillsLoader('./skills');
   * await loader.loadSkills();
   * // Now getSkill('nmap') returns the skill
   *
   * @throws {Error} If the skills directory doesn't exist or is inaccessible
   */
  async loadSkills(): Promise<void> {
    const files = fs.readdirSync(this.skillsDir);

    for (const file of files) {
      if (file.endsWith('_skill.md')) {
        const skillName = file.replace('_skill.md', '');
        const filePath = path.join(this.skillsDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');

        // Extract tool names from skill content
        const tools = this.extractToolNames(content);

        this.skills.set(skillName, {
          name: skillName,
          content,
          tools,
        });

        console.log(`[SkillsLoader] Loaded skill: ${skillName} (${tools.length} tools)`);
      }
    }
  }

  /**
   * Extracts tool names mentioned in a skill document.
   *
   * Uses regex patterns to find tool references in the markdown:
   * - "Command: nmap" → extracts "nmap"
   * - "Action: nmap_host_discovery" → extracts "nmap_host_discovery"
   * - "use nmap" → extracts "nmap"
   *
   * @private
   * @param {string} content - The markdown content to parse
   * @returns {string[]} Array of unique tool names found
   *
   * @example
   * const tools = this.extractToolNames('Command: nmap -sV target');
   * // Returns: ['nmap']
   */
  private extractToolNames(content: string): string[] {
    const tools: string[] = [];

    // Look for patterns like "Command: nmap -sn" or "Action: nmap_host_discovery"
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

  /**
   * Retrieves a skill by its name.
   *
   * @param {string} name - The skill name (e.g., "nmap" for nmap_skill.md)
   * @returns {Skill | undefined} The Skill object if found, undefined otherwise
   *
   * @example
   * const nmapSkill = loader.getSkill('nmap');
   * if (nmapSkill) {
   *   console.log(nmapSkill.content);
   * }
   */
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Returns all loaded skills.
   *
   * @returns {Skill[]} Array of all Skill objects loaded from disk
   *
   * @example
   * const allSkills = loader.getAllSkills();
   * console.log(`Loaded ${allSkills.length} skills`);
   */
  getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Finds skills relevant to a given context using keyword matching.
   *
   * Splits the context into keywords and scores each skill by how many
   * keywords appear in its content. Returns skills sorted by relevance.
   *
   * @param {string} context - The search context (e.g., "scan ports on web server")
   * @returns {Skill[]} Array of matching skills, sorted by relevance (most relevant first)
   *
   * @example
   * const skills = loader.getRelevantSkills('host discovery network');
   * // Returns skills containing those keywords, nmap_skill likely first
   */
  getRelevantSkills(context: string): Skill[] {
    const relevant: Skill[] = [];

    // Simple keyword matching (can be improved with embeddings)
    const keywords = context.toLowerCase().split(/\s+/);

    for (const skill of this.skills.values()) {
      const skillText = skill.content.toLowerCase();
      const relevanceScore = keywords.filter((kw) => skillText.includes(kw)).length;

      if (relevanceScore > 0) {
        relevant.push(skill);
      }
    }

    // Sort by relevance
    return relevant.sort((a, b) => {
      const scoreA = keywords.filter((kw) => a.content.toLowerCase().includes(kw)).length;
      const scoreB = keywords.filter((kw) => b.content.toLowerCase().includes(kw)).length;
      return scoreB - scoreA;
    });
  }

  // ============================================================================
  // MEMORY MANAGER METHODS (CLAUDE.md-style preference injection)
  // ============================================================================

  /**
   * Loads tool rules/preferences from the agent_rules.json file.
   *
   * This is part of the Memory Manager functionality that allows users to
   * persist preferences like "always use -Pn with nmap after host discovery".
   *
   * Rules are stored in JSON format:
   * ```json
   * {
   *   "nmap": ["rule1", "rule2"],
   *   "gobuster": ["rule1"]
   * }
   * ```
   *
   * @returns {ToolRules} Map of tool names to their rule arrays
   *
   * @example
   * const rules = loader.loadRules();
   * console.log(rules.nmap); // ['Always use -Pn after host discovery']
   */
  loadRules(): ToolRules {
    try {
      if (fs.existsSync(this.rulesPath)) {
        const content = fs.readFileSync(this.rulesPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error('[SkillsLoader] Error loading rules:', error);
    }
    return {};
  }

  /**
   * Saves tool rules to the agent_rules.json file.
   *
   * Creates the config directory if it doesn't exist.
   * Rules are persisted in formatted JSON for human readability.
   *
   * @private
   * @param {ToolRules} rules - The rules object to save
   *
   * @example
   * // Internal usage
   * this.saveRules({ nmap: ['Use -Pn after discovery'] });
   */
  private saveRules(rules: ToolRules): void {
    const dir = path.dirname(this.rulesPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.rulesPath, JSON.stringify(rules, null, 2));
  }

  /**
   * Adds a new rule/preference for a specific tool.
   *
   * This is the primary method for the "remember" functionality.
   * When a user says "remember to use -Pn with nmap", this method
   * persists that preference for future sessions.
   *
   * Rules are:
   * - Stored persistently in agent_rules.json
   * - Injected into the LLM context via buildSkillContext()
   * - Deduplicated (same rule won't be added twice)
   *
   * @param {string} toolName - The tool this rule applies to (e.g., "nmap", "gobuster")
   * @param {string} rule - The rule description (e.g., "Always use -Pn after host discovery")
   * @returns {void}
   *
   * @example
   * loader.addRule('nmap', 'Always use -Pn after host discovery');
   * loader.addRule('gobuster', 'Use -t 50 for faster enumeration');
   */
  addRule(toolName: string, rule: string): void {
    const rules = this.loadRules();

    // Create tool entry if it doesn't exist
    if (!rules[toolName]) {
      rules[toolName] = [];
    }

    // Avoid duplicate rules
    if (!rules[toolName].includes(rule)) {
      rules[toolName].push(rule);
      this.saveRules(rules);
      console.log(`[MemoryManager] Added rule for ${toolName}: ${rule}`);
    } else {
      console.log(`[MemoryManager] Rule already exists for ${toolName}`);
    }
  }

  /**
   * Removes a rule by its index within a tool's rule list.
   *
   * This is the primary method for the "forget" functionality.
   * If removing the last rule for a tool, the tool entry is deleted entirely.
   *
   * @param {string} toolName - The tool name
   * @param {number} index - Zero-based index of the rule to remove
   * @returns {boolean} True if the rule was removed, false if not found
   *
   * @example
   * // Remove the first rule for nmap
   * const removed = loader.removeRule('nmap', 0);
   * if (removed) {
   *   console.log('Rule removed successfully');
   * }
   */
  removeRule(toolName: string, index: number): boolean {
    const rules = this.loadRules();

    if (rules[toolName] && rules[toolName][index] !== undefined) {
      const removedRule = rules[toolName].splice(index, 1);
      console.log(`[MemoryManager] Removed rule for ${toolName}: ${removedRule[0]}`);

      // Clean up empty tool entries
      if (rules[toolName].length === 0) {
        delete rules[toolName];
      }

      this.saveRules(rules);
      return true;
    }

    console.log(`[MemoryManager] Rule not found: ${toolName}[${index}]`);
    return false;
  }

  /**
   * Lists all rules for a specific tool or all tools.
   *
   * This is the primary method for the "rules" command.
   *
   * @param {string} [toolName] - Optional tool name to filter by. If omitted, returns all rules.
   * @returns {ToolRules} Map of tool names to their rule arrays
   *
   * @example
   * // List all rules
   * const allRules = loader.listRules();
   *
   * // List rules for a specific tool
   * const nmapRules = loader.listRules('nmap');
   * // Returns: { nmap: ['Always use -Pn after host discovery'] }
   */
  listRules(toolName?: string): ToolRules {
    const rules = this.loadRules();

    if (toolName) {
      return { [toolName]: rules[toolName] || [] };
    }

    return rules;
  }

  /**
   * Clears all rules for a specific tool.
   *
   * Convenience method that removes all rules associated with a tool.
   * Useful for the "forget <tool>" command.
   *
   * @param {string} toolName - The tool to clear rules for
   * @returns {number} Number of rules that were removed
   *
   * @example
   * const count = loader.clearRules('nmap');
   * console.log(`Cleared ${count} rules for nmap`);
   */
  clearRules(toolName: string): number {
    const rules = this.loadRules();
    const count = rules[toolName]?.length || 0;

    if (count > 0) {
      delete rules[toolName];
      this.saveRules(rules);
      console.log(`[MemoryManager] Cleared ${count} rules for ${toolName}`);
    }

    return count;
  }

  // ============================================================================
  // CONTEXT BUILDING (Combines Skills + Rules for LLM injection)
  // ============================================================================

  /**
   * Builds a formatted context string for the LLM with skills AND rules.
   *
   * This is the core method that combines:
   * 1. Relevant skill documents (based on query)
   * 2. User preferences from agent_rules.json
   *
   * The output is injected into the Reasoner's system prompt, allowing
   * the LLM to follow both domain knowledge (skills) and user preferences (rules).
   *
   * Output format:
   * ```
   * # Available Skills
   * ## nmap
   * [skill content...]
   *
   * # Tool Preferences (IMPORTANT - Follow these rules)
   * ## nmap
   * - Always use -Pn after host discovery
   * ```
   *
   * @param {string} query - The query to find relevant skills for
   * @returns {string} Formatted markdown string with skill content and rules
   *
   * @example
   * const context = loader.buildSkillContext('reconnaissance pentest');
   * reasoner.setSkillContext(context);  // Inject into Reasoner
   */
  buildSkillContext(query: string): string {
    const relevantSkills = this.getRelevantSkills(query);
    const rules = this.loadRules();

    let context = '';

    // Add skills section
    if (relevantSkills.length > 0) {
      context += '# Available Skills\n\n';

      for (const skill of relevantSkills.slice(0, 3)) {
        // Top 3 most relevant
        context += `## ${skill.name}\n\n`;
        context += `${skill.content}\n\n`;
        context += `---\n\n`;
      }
    }

    // Add rules section (Tool Preferences) - IMPORTANT for LLM compliance
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

  /**
   * Gets the path to the rules file.
   *
   * Useful for debugging or displaying to users.
   *
   * @returns {string} Absolute path to agent_rules.json
   *
   * @example
   * console.log(`Rules stored at: ${loader.getRulesPath()}`);
   */
  getRulesPath(): string {
    return this.rulesPath;
  }
}
