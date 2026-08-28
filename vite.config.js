import { defineConfig } from 'vitest/config';

export default defineConfig({
    build: {
        emptyOutDir: true,
        lib: {
            entry: 'src/index.js',
            name: 'State',
        },
        minify: false,
        outDir: 'dist',
        rolldownOptions: {
            output: [
                {
                    entryFileNames: 'frost-state.js',
                    format: 'umd',
                    minify: false,
                    name: 'State',
                },
                {
                    entryFileNames: 'frost-state.min.js',
                    format: 'umd',
                    minify: true,
                    name: 'State',
                },
                {
                    entryFileNames: 'frost-state.esm.js',
                    format: 'es',
                    minify: false,
                },
                {
                    entryFileNames: 'frost-state.esm.min.js',
                    format: 'es',
                    minify: true,
                },
            ],
        },
        sourcemap: true,
        target: 'baseline-widely-available',
    },
    test: {
        allowOnly: false,
        coverage: {
            include: ['src/**/*.js'],
            reporter: ['text', 'lcov'],
        },
    },
});
