export const STYLE_IDS = ['professional', 'trendy', 'minimalist', 'comprehensive'] as const;
export type StyleId = (typeof STYLE_IDS)[number];

export interface StyleDefinition {
  id: StyleId;
  label: string;
  summary: string;
  instruction: string;
  /** Section headings the style prefers, in order, used only when evidence exists. */
  preferredSections: string[];
}

export const STYLES: Record<StyleId, StyleDefinition> = {
  professional: {
    id: 'professional',
    label: 'Professional',
    summary: 'Clear value proposition, restrained design, standard technical sections.',
    instruction:
      'Write in a clear, confident, neutral tone. Open with a one-paragraph value proposition. Use restrained formatting: no emoji, at most a few badges. Use standard technical sections (Overview, Features, Installation, Usage, Configuration, Development, Contributing, License) only when the brief has evidence for them.',
    preferredSections: ['Overview', 'Features', 'Installation', 'Usage', 'Configuration', 'Development', 'Contributing', 'License'],
  },
  trendy: {
    id: 'trendy',
    label: 'Trendy',
    summary: 'Strong visual hierarchy, compact badges/callouts, modern friendly tone.',
    instruction:
      'Write in a modern, friendly, energetic tone. Use strong visual hierarchy: a short tagline, compact badges, GitHub callouts (> [!TIP], > [!NOTE]) and occasional emoji in headings. Keep paragraphs short and scannable. Never invent badges for services the brief does not show the project using.',
    preferredSections: ['✨ Highlights', '🚀 Quick start', '📦 Installation', '🛠 Usage', '🧑‍💻 Development', '🤝 Contributing', '📄 License'],
  },
  minimalist: {
    id: 'minimalist',
    label: 'Minimalist',
    summary: 'Only essential sections; short copy, low decoration.',
    instruction:
      'Write only the essentials: one-sentence description, Install, Usage, License. Short sentences, no badges, no emoji, no marketing language. Omit any section without evidence.',
    preferredSections: ['Install', 'Usage', 'License'],
  },
  comprehensive: {
    id: 'comprehensive',
    label: 'Comprehensive',
    summary: 'Detailed setup, configuration, architecture, contribution, troubleshooting where evidence exists.',
    instruction:
      'Write a thorough reference README: table of contents, prerequisites, detailed installation, usage, configuration, project structure/architecture, development workflow, testing, CI, contributing, troubleshooting and license. Include each section only where the brief provides evidence; list gaps as unknowns rather than guessing.',
    preferredSections: [
      'Table of contents',
      'Overview',
      'Prerequisites',
      'Installation',
      'Usage',
      'Configuration',
      'Project structure',
      'Development',
      'Testing',
      'Continuous integration',
      'Contributing',
      'Troubleshooting',
      'License',
    ],
  },
};

export function parseStyle(input: string | undefined): StyleId | null {
  if (!input) return null;
  const v = input.trim().toLowerCase();
  return (STYLE_IDS as readonly string[]).includes(v) ? (v as StyleId) : null;
}
