import * as fs from 'fs';
import * as path from 'path';

/**
 * Represents a loaded skill document.
 *
 * Skills are markdown files that contain domain knowledge and tool usage
 * guidance for specific security tools (e.g., nmap_skill.md).
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
 * SkillsLoader - Dynamic skill management for the pentest agent.
 *
 * Skills are markdown documents that provide domain expertise and tool
 * guidance to the Reasoner. They help the AI make better decisions
 * about which tools to use and how to interpret results.
 *
 * Skills are loaded from *_skill.md files in the skills directory.
 */
export class SkillsLoader {
  private skillsDir: string;
  private skills: Map<string, Skill> = new Map();

  /**
   * Creates a new SkillsLoader.
   *
   * @param skillsDir - Path to directory containing *_skill.md files
   */
  constructor(skillsDir: string = './skills') {
    this.skillsDir = skillsDir;
  }

  /**
   * Loads all skill documents from the skills directory.
   *
   * Scans for files matching *_skill.md pattern, reads their content,
   * extracts tool names mentioned within, and stores them for later use.
   *
   * @example
   * // Given skills/nmap_skill.md exists:
   * await loader.loadSkills();
   * // Now getSkill('nmap') returns the skill
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
   * @param content - The markdown content to parse
   * @returns Array of unique tool names found
   */
  private extractToolNames(content: string): string[] {
    const tools: string[] = [];
    
    // Look for patterns like "Command: nmap -sn" or "Action: nmap_host_discovery"
    const toolPatterns = [
      /Command:\s*(\w+)/g,
      /Action:\s*(\w+)/g,
      /use\s+(\w+)/g,
    ];
    
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
   * @param name - The skill name (e.g., "nmap" for nmap_skill.md)
   * @returns The Skill object if found, undefined otherwise
   */
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Returns all loaded skills.
   *
   * @returns Array of all Skill objects loaded from disk
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
   * @param context - The search context (e.g., "scan ports on web server")
   * @returns Array of matching skills, sorted by relevance (most relevant first)
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
      const relevanceScore = keywords.filter(kw => skillText.includes(kw)).length;
      
      if (relevanceScore > 0) {
        relevant.push(skill);
      }
    }
    
    // Sort by relevance
    return relevant.sort((a, b) => {
      const scoreA = keywords.filter(kw => a.content.toLowerCase().includes(kw)).length;
      const scoreB = keywords.filter(kw => b.content.toLowerCase().includes(kw)).length;
      return scoreB - scoreA;
    });
  }

  /**
   * Builds a formatted context string for the LLM with relevant skills.
   *
   * Takes the top 3 most relevant skills and formats them into a
   * markdown document that can be injected into the Reasoner's system prompt.
   *
   * @param query - The query to find relevant skills for
   * @returns Formatted markdown string with skill content, or a message if no skills found
   *
   * @example
   * const context = loader.buildSkillContext('reconnaissance pentest');
   * reasoner.setSkillContext(context);  // Inject into Reasoner
   */
  buildSkillContext(query: string): string {
    const relevantSkills = this.getRelevantSkills(query);
    
    if (relevantSkills.length === 0) {
      return "No specific skills loaded for this task.";
    }
    
    let context = "# Available Skills\n\n";
    
    for (const skill of relevantSkills.slice(0, 3)) {  // Top 3 most relevant
      context += `## ${skill.name}\n\n`;
      context += `${skill.content}\n\n`;
      context += `---\n\n`;
    }
    
    return context;
  }
}