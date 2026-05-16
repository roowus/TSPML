import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'src/index.ts',
  output: {
    file: 'dist/tspml.js',
    format: 'iife',
    name: 'TSPML',
    globals: {
      // PolyTrack globals
      'window': 'window',
      'document': 'document'
    }
  },
  plugins: [
    resolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      declaration: false,
      sourceMap: true
    })
  ],
  external: []  // Bundle everything for browser
};
