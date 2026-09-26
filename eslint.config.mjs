import obsidianmd from 'eslint-plugin-obsidianmd';
export default [
    { ignores: ['main.js', 'tests/**', 'esbuild.config.mjs', 'version-bump.mjs'] },
    ...obsidianmd.configs.recommended,
    { languageOptions: { parserOptions: { projectService: { allowDefaultProject: ['eslint.config.mjs'] } } } }
];
