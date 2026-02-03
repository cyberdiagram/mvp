import * as fs from 'fs';
import * as path from 'path';

export interface Skill {
  name: string;
  content: string;
  tools: string[];  // Tools mentioned in skill (nmap_host_discovery, etc.)
}

export class SkillsLoader {
  private skillsDir: string;
  private skills: Map<string, Skill> = new Map();

  constructor(skillsDir: string = './skills') {
    this.skillsDir = skillsDir;
  }

  /**
   * Load all skills from markdown files
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
   * Extract tool names from skill markdown
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
   * Get skill by name
   */
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Get all skills
   */
  getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get relevant skills based on current context
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
   * Build context string for LLM with relevant skills
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