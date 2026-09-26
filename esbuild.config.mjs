import * as esbuild from 'esbuild';
const production = process.argv[2] === 'production';
const context = await esbuild.context({
    entryPoints: ['main.ts'], bundle: true, external: ['obsidian'],
    format: 'cjs', target: 'es2020', outfile: 'main.js',
    sourcemap: production ? false : 'inline', minify: false, logLevel: 'info'
});
if (production) {
    await context.rebuild();
    await context.dispose();
} else {
    await context.watch();
}
